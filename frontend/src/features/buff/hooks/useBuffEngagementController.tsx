import { App, Button, Tooltip } from 'antd';
import {
  type AutoBuffProgress,
  type BatchOrder,
  type BuffLogEntry,
  type BuffMonitor,
  type FanpageItem,
  type SpeedModeKey,
} from '../types';
import { LEGACY_BUFF_LOGS_STORAGE_KEY, SPEED_PRESETS } from '../constants';
import { StopOutlined } from '@ant-design/icons';
import api, { WORKER_BASE_URL } from '../../../config/axios';
import axios from 'axios';
import { isFacebookPostUrl, mergeBuffLogs, normalizeFbPostUrlClient, readLegacyBuffLogs } from '../utils';
import { useCookieAlert } from '../../../components/common/CookieAlertManager';
import { useBmOverview, useBuffMonitors, useBuffQueue, useSystemSettings } from './usePolledData';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BuffEngagementProps } from '../../../pages/BuffEngagement';
import { useSingleRunner } from './useSingleRunner';
import { useBatchRunner } from './useBatchRunner';
import { useAccountsAndPages } from './useAccountsAndPages';

/**
 * All state, effects and handlers of the Likes & Comments page.
 * `pages/BuffEngagement.tsx` only handles the UI; child tabs receive a `BuffController`.
 */
export function useBuffEngagementController(props: BuffEngagementProps = {}) {
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
  // Likes the user asked for vs Pages actually picked. When dead Vias leave fewer Pages than asked, the run's
  // target used to shrink silently to the picked count, so history never showed the shortfall to top up later.
  const [likeRequest, setLikeRequest] = useState<{ requested: number; picked: number } | null>(null);
  const requestedLikes =
    likeRequest && likeRequest.picked === selectedPageIds.length
      ? Math.max(likeRequest.requested, selectedPageIds.length)
      : selectedPageIds.length;
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
  // "Custom" only exists in the UI: the speedMode sent to the backend is unchanged, the user picks the delay
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

  // Load status and avatar URLs of the Fanpages
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

  // Receive a post link passed automatically from the Economy Job
  useEffect(() => {
    const urlParam = searchParams.get('url') || searchParams.get('targetUrl');
    if (urlParam) {
      setTargetPostUrl(urlParam);
      message.info(`Đã nạp link bài từ Economy Job: ${urlParam}`);
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

  // Post info and config of the live run (frees the New form so another link can be entered)
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

  // Clock for the live run: start/end times and a once-per-second tick
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


  // Restore a live Buff session or a Queue task running in the background if the user reloads or opens the page
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
            currentRunningPageName: session.currentRunningPageName || 'Đang chạy...',
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
                      content: `🎉 Task buff chạy nền đã xong: ${live.success}/${live.total} thành công!`,
                      key: 'restore-buff-session',
                      duration: 5,
                    });
                  } else if (live.status === 'STOPPED') {
                    message.warning({
                      content: 'Đã dừng task buff chạy nền theo yêu cầu.',
                      key: 'restore-buff-session',
                    });
                  }
                }
              } catch (err) {
                console.error('Failed to check progress:', err);
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
        // ignore if the backend doesn't respond
      }
    };

    restoreActiveSession();
    // Auto-check every 2.5 seconds when there's no pollTimer, to catch any Queue / Post Hunter / Resume task
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

  // Buff mode: 1 single link or many posts in bulk
  const [buffMode, setBuffMode] = useState<'SINGLE' | 'BATCH'>('SINGLE');

  // Engagement mode: React, Comment, or Both
  const [engagementMode, setEngagementMode] = useState<'LIKE_AND_COMMENT' | 'LIKE_ONLY' | 'COMMENT_ONLY'>('LIKE_AND_COMMENT');
  const [commentListText, setCommentListText] = useState<string>('');
  const [inlineCommentEditorOpen, setInlineCommentEditorOpen] = useState<boolean>(false);
  const parsedCommentLines = useMemo(
    () => commentListText.split('\n').map((s) => s.trim()).filter(Boolean),
    [commentListText]
  );

  // Buff Share: automatically share the post to the Fanpage wall
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

  // IDs of Fanpages that already liked this post link in the backend (including /share/ links to the same post)
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

  // New tab: run now or add to the queue
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
        message.warning('Vui lòng chọn thời gian bắt đầu!');
        return;
      }
      const [hh, mm] = queueStartAt.split(':').map(Number);
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1); // time already passed → schedule for tomorrow
      delayMinutes = Math.max(0, Math.round((target.getTime() - Date.now()) / 60000));
    }

    const payload = {
      targetLikes: requestedLikes,
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
          message.info(res.data.message || 'Bài này đã được chạy rồi.');
          return;
        }
        if (res.data?.alreadyQueued) {
          message.info(res.data.message || 'Bài này đã có trong hàng đợi.');
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
        if (res.data?.skippedCount > 0) message.info(`Đã bỏ qua ${res.data.skippedCount} bài đã chạy trước đó.`);
      }
      if (buffMode === 'BATCH') setBatchLinksText('');
      else setTargetPostUrl('');
      fetchBuffQueue();
      setActiveTabKey('buff-queue');
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || 'Không thêm được vào hàng đợi');
    } finally {
      setIsEnqueueing(false);
    }
  };

  const handleAddQueueTask = async () => {
    if (!queueUrlInput.trim()) {
      message.warning('Vui lòng nhập link bài Facebook!');
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
          message.success('Đã thêm bài vào hàng đợi tự động!');
          setQueueUrlInput('');
          fetchBuffQueue();
        }
      } else {
        message.error(res.data?.error || 'Lỗi khi thêm vào hàng đợi');
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
        message.success('Đã cho task chạy ngay!');
        fetchBuffQueue();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleStopQueueTask = (id: string) => {
    modal.confirm({
      title: 'Chỉ dừng bài này?',
      content: 'Worker sẽ dừng bài này sau Page hiện tại (các bài khác trong hàng đợi vẫn chạy bình thường).',
      okText: 'Dừng bài này',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/stop/${id}`);
          if (res.data?.success) {
            message.success(res.data.message || 'Đã gửi lệnh dừng bài này.');
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
      title: 'Xóa task này khỏi hàng đợi?',
      okText: 'Xóa',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.delete(`${WORKER_BASE_URL}/api/buff-queue/remove/${id}`);
          if (res.data?.success) {
            message.success('Đã xóa task khỏi hàng đợi.');
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
        message.success(`Đã dọn ${res.data.cleared} bài đã xong!`);
        fetchBuffQueue();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleClearAllQueue = () => {
    modal.confirm({
      title: 'Xóa toàn bộ hàng đợi?',
      content: 'Thao tác này sẽ xóa mọi bài trong hàng đợi.',
      okText: 'Xóa tất cả',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/clear-all`);
          if (res.data?.success) {
            message.success('Đã xóa toàn bộ hàng đợi!');
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
        message.success('Đã xếp bài vào hàng đợi để chạy lại!');
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

  // Vias with expired cookies or a checkpoint (from the overview data, auto-refreshed every 15 seconds)
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
    // The first load only records the state without notifying; afterwards notify when a Via newly turns bad
    if (notifiedDeadViaRef.current) {
      const newlyDead = deadViaList.filter((v) => !notifiedDeadViaRef.current!.has(v.uid));
      if (newlyDead.length > 0) {
        notification.warning({
          key: 'via-dead',
          message: newlyDead.length === 1 ? 'Có Via cần cập nhật Cookie' : `${newlyDead.length} Via cần cập nhật Cookie`,
          description: (
            <div className="space-y-0.5">
              {newlyDead.map((v) => (
                <div key={v.uid}>
                  {v.viaName || v.uid} · {v.tokenStatus === 'CHECKPOINT' ? 'checkpointed' : 'cookie hết hạn'}
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
        message.success('Đã lưu cài đặt hệ thống & bot Telegram!');
        setIsSettingsModalOpen(false);
        fetchBmOverview();
        fetchSettings();
      } else {
        message.error(res.data?.error || 'Lưu cài đặt thất bại');
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    message.loading({ content: 'Đang gửi tin thử tới Telegram...', key: 'testTele' });
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-settings/test-telegram`, {
        botToken: systemSettings.telegramBotToken || undefined,
        chatId: systemSettings.telegramChatId || undefined,
      });
      if (res.data?.success) {
        message.success({ content: 'Đã gửi tin Telegram! Kiểm tra điện thoại nhé.', key: 'testTele', duration: 4 });
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
        reason: 'Quản trị viên bật dừng khẩn cấp từ thanh lệnh',
      });
      if (res.data?.success) {
        message.warning(
          res.data.jobStillFinishing
            ? 'Đã bật dừng khẩn cấp. Job đang chạy sẽ dừng sau Page hiện tại.'
            : 'Đã bật dừng khẩn cấp. Hàng đợi và Săn bài đã tạm dừng.'
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
        message.success('Hệ thống đã hoạt động bình thường trở lại!');
        fetchBmOverview();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleRunViaHealthCheck = async () => {
    setCheckingViaHealth(true);
    message.loading({ content: 'Đang kiểm tra kết nối và trạng thái từng Via trên Facebook...', key: 'viaHealth' });
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-vias/health-check`);
      if (res.data?.success) {
        setViaHealthResults(res.data.vias || []);
        setIsHealthModalOpen(true);
        message.success({
          content: `Kiểm tra xong: ${res.data.liveCount}/${res.data.total} Via còn TỐT (LIVE)!`,
          key: 'viaHealth',
          duration: 4,
        });
        fetchBmOverview();
        refetchAccounts();
      } else {
        message.error({ content: res.data?.error || 'Kiểm tra Via thất bại', key: 'viaHealth' });
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
      title: 'Xóa monitor này?',
      content: 'Hệ thống sẽ ngừng quét bài mới ở mục tiêu này.',
      okText: 'Xóa',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.delete(`${WORKER_BASE_URL}/api/buff-monitors/${id}`);
          if (res.data?.success) {
            message.success('Đã xóa monitor.');
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
              ? `Đã tạm dừng Săn bài và hủy ${cancelled} task Săn bài!`
              : 'Đã tạm dừng Săn bài!'
          );
        } else {
          message.success('Đã bật lại Săn bài!');
        }
        fetchBuffMonitors();
        fetchBuffQueue();
        fetchBmOverview();
      } else {
        message.error(res.data?.error || 'Không cập nhật được trạng thái Săn bài');
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
      message.loading({ content: 'Đang quét bài mới ở mục tiêu...', key: 'scanMon' });
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors/${id}/scan-now`);
      if (res.data?.success) {
        message.success({
          content: res.data.baseline
            ? `Lần quét đầu: đã ghi nhận ${res.data.postsFound} bài hiện có làm mốc. Từ giờ chỉ buff bài đăng sau thời điểm này.`
            : `Quét xong: thấy ${res.data.postsFound} bài, đã xếp hàng ${res.data.newPostsEnqueued} bài mới${
                res.data.skippedByLimit ? `, ${res.data.skippedByLimit} bài bị giữ do giới hạn ngày` : ''
              }.`,
          key: 'scanMon',
          duration: 4,
        });
        fetchBuffMonitors();
        fetchBuffQueue();
      } else {
        message.error({ content: res.data?.error || 'Quét mục tiêu thất bại', key: 'scanMon' });
      }
    } catch (err: any) {
      message.error({ content: err.response?.data?.error || err.message, key: 'scanMon' });
    }
  };


  // AI Seeding Studio & Spintax State
  const [aiStudioModalOpen, setAiStudioModalOpen] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState<string>('GENERAL');

  // Call Gemini AI to generate natural comments for the post
  const handleGenerateAiComments = async () => {
    if (!targetPostUrl.trim() && !aiPostPrompt.trim()) {
      message.warning('Vui lòng dán link bài hoặc nhập chủ đề để AI tạo bình luận!');
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
        message.success(`Gemini AI đã tạo ${res.data.comments.length} bình luận tự nhiên cho bài!`);
      } else {
        message.warning('AI không trả về bình luận nào, vui lòng thử lại.');
      }
    } catch (err: any) {
      message.error(`Lỗi AI tạo bình luận: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsAiGeneratingComments(false);
    }
  };

  // Warn about keywords likely to be flagged as spam in Groups (test, bot, tool, "tự động"...)
  const detectedSpamKeywords = useMemo(() => {
    if (engagementMode === 'LIKE_ONLY' || !commentListText.trim()) return [];
    const lower = commentListText.toLowerCase();
    const badWords = ['test', 'tự động', 'bot', 'tool', 'toolzutter', 'buff', 'hack', 'spam'];
    return badWords.filter((w) => lower.includes(w));
  }, [engagementMode, commentListText]);

  // Automatically switch to a safe delay when comments are on
  useEffect(() => {
    if (engagementMode !== 'LIKE_ONLY') {
      if (delayMs < 12000) {
        setDelayMs(12000); // 12 seconds is safe with comments
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
        // Speed optimization: load only the summary, not the heavy JSON details array
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
        // Move old localStorage history to MySQL (upsert by id, so re-running doesn't duplicate)
        const legacy = readLegacyBuffLogs();
        if (legacy.length > 0) {
          await api.post('/buff-logs', { logs: legacy });
          localStorage.removeItem(LEGACY_BUFF_LOGS_STORAGE_KEY);
          if (!cancelled) message.success(`Đã đồng bộ ${legacy.length} mục lịch sử cũ lên hệ thống`);
        }
        const res = await api.get('/buff-logs', { params: { limit: 500, summary: 'true' } });
        const fetched: BuffLogEntry[] = Array.isArray(res.data?.logs) ? res.data.logs : [];
        // Keep the just-finished log while loading
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

  // Auto-refresh when the user opens the History tab
  useEffect(() => {
    if (activeTabKey === 'buff-history') {
      reloadBuffLogs(true);
    }
  }, [activeTabKey, reloadBuffLogs]);

  const addBuffLog = useCallback(
    (log: BuffLogEntry) => {
      setBuffLogs((prev) => [log, ...prev]);
      api.post('/buff-logs', { log }).catch((err) => {
        message.warning(`Lịch sử chưa lưu lên server: ${err.response?.data?.error || err.message}`);
      });
    },
    [message]
  );



  // Open the Settings modal from the Sidebar
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

  // Fanpages that already liked this post link in history (URL normalized to match trailing / or tracking params)
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

  // Batch Buff State (bulk likes across many posts)
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
  const [batchLinkConcurrency, setBatchLinkConcurrency] = useState<number>(2); // 1: sequential, 2: 2 links in parallel
  const batchWaitSeconds = 2;
  const [batchOrders, setBatchOrders] = useState<BatchOrder[]>([]);
  const [pageDisplayLimit, setPageDisplayLimit] = useState<number>(60);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isBatchPaused, setIsBatchPaused] = useState<boolean>(false);
  const batchAbortRef = useRef<boolean>(false);
  const batchPauseRef = useRef<boolean>(false);
  const buffAbortRef = useRef<AbortController | null>(null);
  const batchStreamAbortControllersRef = useRef<Set<AbortController>>(new Set());


  // Leaving the page cancels every running stream (the worker stops after the current page)
  useEffect(() => {
    return () => {
      batchAbortRef.current = true;
      batchPauseRef.current = false;
      buffAbortRef.current?.abort();
      batchStreamAbortControllersRef.current.forEach((c) => c.abort());
      batchStreamAbortControllersRef.current.clear();
    };
  }, []);

  const {
    queryClient,
    managePagesModalOpen,
    setManagePagesModalOpen,
    targetViaForModal,
    setTargetViaForModal,
    loadingAccounts,
    refetchAccounts,
    accounts,
    fbAccounts,
    activeCookie,
    currentViaAccount,
    modalViaAccount,
    currentModalPages,
    handleOpenManagePages,
    parsedBatchLinks,
    invalidBatchLinesCount,
    runEstimate,
    handleSavePagesForTargetVia,
    handleDeletePageForTargetVia,
    handleClearPagesForTargetVia,
    viaGroupCounts,
    selectedPageIdsSet,
    alreadyLikedPageIdsSet,
    combinedAlreadyLikedIds,
    unlikedScannedPages,
    deadViaSummary,
    usableUnlikedCount,
    filteredPages,
    expiredPagesSelectedCount,
    handleReplaceExpiredPagesWithLiveOnes,
    handleSelectAllUnliked,
    handleSelectRandomPages,
    scanPagesMutation,
  } = useAccountsAndPages({
    props,
    queueItems,
    buffLogs,
    monitors,
    selectedAccountId,
    customCookie,
    setSelectedAccountId,
    setScannedPages,
    setSelectedPageIds,
    actorMode,
    scannedPages,
    setBatchLikesPerOrder,
    batchLinksText,
    buffMode,
    targetPostUrl,
    selectedPageIds,
    delayMs,
    concurrency,
    message,
    alreadyLikedPagesForUrl,
    interactedPageIds,
    viaFilter,
    likeFilter,
    pageSearchQuery,
    autoSkipAlreadyLiked,
    autoFailoverLiveVia,
    setLikeRequest,
  });
  const {
    autoBuffMutation,
    handleStopAutoBuff,
    isResumingRemaining,
    resumeModalOpen,
    setResumeModalOpen,
    resumeTargetUrl,
    resumeDoneLikes,
    resumeTargetLikes,
    resumeMissingLikes,
    setResumeMissingLikes,
    resumeReaction,
    setResumeReaction,
    handleResumeRemaining,
    handleConfirmResume,
    handleStartNewCampaign,
  } = useSingleRunner({
    bmOverview,
    activeCookie,
    targetPostUrl,
    selectedPageIds,
    scannedPages,
    selectedPageIdsSet,
    autoSkipAlreadyLiked,
    alreadyLikedPageIdsSet,
    parsedCommentLines,
    commentListText,
    engagementMode,
    interactedPageIds,
    setRunTiming,
    setLiveLogs,
    setAutoBuffProgress,
    setRunningTargetInfo,
    selectedReaction,
    actorMode,
    speedMode,
    setActiveTabKey,
    setTargetPostUrl,
    selectedAccountId,
    fbAccounts,
    currentViaAccount,
    buffAbortRef,
    autoFailoverLiveVia,
    requestedLikes,
    alreadyLikedPagesForUrl,
    delayMs,
    enableShare,
    enableHumanBehavior,
    fastSwitch,
    antiCheckpointGuard,
    concurrency,
    dripFeedMode,
    dripDurationMinutes,
    addLiveLog,
    setInteractedPageIds,
    addBuffLog,
    message,
    notification,
    runningTargetInfo,
    autoBuffProgress,
    queueItems,
    fetchBuffQueue,
    queryClient,
    initialFinishedRestoreDoneRef,
  });

  const {
    handleScanPages,
    handleStartAutoBuff,
    handleStartBatchBuff,
    handleStopBatchBuff,
    handleRefillSingleOrder,
    handleRefillBatchIncomplete,
  } = useBatchRunner({
    setViewProgress,
    targetViews,
    targetViewUrl,
    viewConcurrency,
    watchTimeSeconds,
    message,
    setTargetPostUrl,
    setSelectedReaction,
    targetPostUrl,
    selectedReaction,
    activeCookie,
    scanPagesMutation,
    selectedPageIds,
    autoBuffMutation,
    parsedBatchLinks,
    scannedPages,
    selectedPageIdsSet,
    autoFailoverLiveVia,
    actorMode,
    batchLikesPerOrder,
    autoSkipAlreadyLiked,
    fetchInteractedPageIdsForUrl,
    commentListText,
    selectedAccountId,
    fbAccounts,
    setRunTiming,
    setBatchOrders,
    setIsBatchRunning,
    setIsBatchPaused,
    batchAbortRef,
    batchPauseRef,
    setActiveTabKey,
    batchStreamAbortControllersRef,
    delayMs,
    speedMode,
    engagementMode,
    enableShare,
    enableHumanBehavior,
    fastSwitch,
    antiCheckpointGuard,
    concurrency,
    dripFeedMode,
    dripDurationMinutes,
    addBuffLog,
    batchLinkConcurrency,
    batchWaitSeconds,
    notification,
    isBatchPaused,
    setBuffMode,
    setSelectedAccountId,
    handleSelectRandomPages,
    batchOrders,
    setBatchLinksText,
    setBatchLikesPerOrder,
  });
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
    const applied = `Đã áp dụng: 1 link · Like + bình luận · Cảm xúc tự nhiên · ${scannedPages.length} Page`;
    if (targetPostUrl.trim()) {
      message.success(`${applied}. AI đang viết bình luận theo nội dung bài...`);
      handleGenerateAiComments();
    } else {
      message.info(`${applied}. Dán link bài để AI đọc và viết bình luận.`);
    }
  };

  const handleQuickPresetVias = () => {
    setBuffMode('SINGLE');
    setActorMode('VIAS');
    setSelectedAccountId('ALL_VIAS');
    message.success(`Đã áp dụng: 1 link · Dùng ${fbAccounts.length} tài khoản cá nhân thay cho Page (giữ chế độ và cảm xúc)`);
  };

  // Check whether any buff task is currently running (dim the button when there are 0)
  const isAnyBuffRunning = Boolean(
    autoBuffMutation.isPending ||
    autoBuffProgress?.status === 'RUNNING' ||
    isBatchRunning ||
    queueItems.some((it) => it.status === 'RUNNING') ||
    (bmOverview?.stats?.runningCount || 0) > 0
  );

  const isBuffTab = ['buff-like', 'buff-running', 'buff-queue', 'buff-history', 'buff-hunter'].includes(activeTabKey);

  const emergencyStopButton = (
    <Tooltip title="Dừng ngay mọi tiến trình đang chạy để bảo vệ tài khoản">
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


  return {
    message,
    openCookieAlertModal,
    activeTabKey,
    setActiveTabKey,
    selectedAccountId,
    setSelectedAccountId,
    customCookie,
    setCustomCookie,
    targetPostUrl,
    setTargetPostUrl,
    selectedReaction,
    setSelectedReaction,
    scannedPages,
    setScannedPages,
    actorMode,
    setActorMode,
    selectedPageIds,
    setSelectedPageIds,
    handleTogglePageId,
    pageSearchQuery,
    setPageSearchQuery,
    viaFilter,
    setViaFilter,
    likeFilter,
    setLikeFilter,
    speedMode,
    setSpeedMode,
    delayMs,
    setDelayMs,
    customSpeed,
    setCustomSpeed,
    enableHumanBehavior,
    setEnableHumanBehavior,
    fastSwitch,
    setFastSwitch,
    antiCheckpointGuard,
    setAntiCheckpointGuard,
    isAiGeneratingComments,
    concurrency,
    setConcurrency,
    dripFeedMode,
    setDripFeedMode,
    dripDurationMinutes,
    setDripDurationMinutes,
    autoFailoverLiveVia,
    setAutoFailoverLiveVia,
    showAdvancedSettings,
    setShowAdvancedSettings,
    aiPostPrompt,
    setAiPostPrompt,
    aiTone,
    setAiTone,
    aiCount,
    setAiCount,
    avatarCacheMap,
    autoBuffProgress,
    runningTargetInfo,
    liveLogs,
    runTiming,
    buffMode,
    setBuffMode,
    engagementMode,
    setEngagementMode,
    commentListText,
    setCommentListText,
    inlineCommentEditorOpen,
    setInlineCommentEditorOpen,
    parsedCommentLines,
    enableShare,
    setEnableShare,
    seedingPresets,
    interactedPagesLoading,
    queueItems,
    fetchBuffQueue,
    runMode,
    setRunMode,
    queueStartAfter,
    setQueueStartAfter,
    queueStartAt,
    setQueueStartAt,
    queueStagger,
    setQueueStagger,
    isEnqueueing,
    handleEnqueueFromForm,
    handleRunNowQueueTask,
    handleStopQueueTask,
    handleRemoveQueueTask,
    handleClearCompletedQueue,
    handleClearAllQueue,
    handleRetryQueueTask,
    monitors,
    postHunterPaused,
    fetchBuffMonitors,
    isMonitorModalOpen,
    setIsMonitorModalOpen,
    monitorModalTarget,
    checkingViaHealth,
    viaHealthResults,
    isHealthModalOpen,
    setIsHealthModalOpen,
    bmOverview,
    fetchBmOverview,
    systemSettings,
    setSystemSettings,
    savingSettings,
    testingTelegram,
    deadViaList,
    handleSaveSettings,
    handleTestTelegram,
    handleEmergencyStop,
    handleResumeSystem,
    handleRunViaHealthCheck,
    handleOpenAddMonitorModal,
    handleDeleteMonitor,
    handleTogglePostHunterPaused,
    handleToggleMonitor,
    handleScanNowMonitor,
    aiStudioModalOpen,
    setAiStudioModalOpen,
    selectedNiche,
    setSelectedNiche,
    handleGenerateAiComments,
    buffLogs,
    setBuffLogs,
    buffLogsLoading,
    loadingLogDetailId,
    handleViewLogDetail,
    reloadBuffLogs,
    autoSkipAlreadyLiked,
    setAutoSkipAlreadyLiked,
    logSearchQuery,
    setLogSearchQuery,
    selectedLogDetail,
    setSelectedLogDetail,
    batchLinksText,
    setBatchLinksText,
    batchLikesPerOrder,
    setBatchLikesPerOrder,
    batchLinkConcurrency,
    setBatchLinkConcurrency,
    batchOrders,
    setBatchOrders,
    pageDisplayLimit,
    setPageDisplayLimit,
    isBatchRunning,
    queryClient,
    managePagesModalOpen,
    setManagePagesModalOpen,
    targetViaForModal,
    setTargetViaForModal,
    loadingAccounts,
    refetchAccounts,
    accounts,
    fbAccounts,
    currentViaAccount,
    modalViaAccount,
    currentModalPages,
    handleOpenManagePages,
    parsedBatchLinks,
    invalidBatchLinesCount,
    runEstimate,
    handleSavePagesForTargetVia,
    handleDeletePageForTargetVia,
    handleClearPagesForTargetVia,
    viaGroupCounts,
    selectedPageIdsSet,
    combinedAlreadyLikedIds,
    unlikedScannedPages,
    deadViaSummary,
    usableUnlikedCount,
    filteredPages,
    expiredPagesSelectedCount,
    handleReplaceExpiredPagesWithLiveOnes,
    handleSelectAllUnliked,
    handleSelectRandomPages,
    scanPagesMutation,
    autoBuffMutation,
    handleStopAutoBuff,
    isResumingRemaining,
    resumeModalOpen,
    setResumeModalOpen,
    resumeTargetUrl,
    resumeDoneLikes,
    resumeTargetLikes,
    resumeMissingLikes,
    setResumeMissingLikes,
    resumeReaction,
    setResumeReaction,
    handleResumeRemaining,
    handleConfirmResume,
    handleStartNewCampaign,
    handleScanPages,
    handleStartAutoBuff,
    handleStartBatchBuff,
    handleStopBatchBuff,
    handleRefillSingleOrder,
    handleRefillBatchIncomplete,
    handleQuickPresetLike24,
    handleQuickPresetAiSeeding,
    handleQuickPresetVias,
    isAnyBuffRunning,
    isBuffTab,
    emergencyStopButton,
  };
}

export type BuffController = ReturnType<typeof useBuffEngagementController>;
