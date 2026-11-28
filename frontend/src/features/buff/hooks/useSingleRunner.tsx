import {
  type AutoBuffResultDetail,
  type BuffLogEntry,
  type AutoBuffProgress,
  type FanpageItem,
  type SpeedModeKey,
} from '../types';
import { useRef } from 'react';
import api, { WORKER_BASE_URL } from '../../../config/axios';
import axios from 'axios';
import {
  groupPagesByVia,
  isFacebookPostUrl,
  playVictoryChime,
  runBuffStream,
  summarizeBuffDetails,
  isDeadViaStatus,
} from '../utils';
import { triggerCookieExpiredAlert } from '../../../components/common/CookieAlertManager';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { type MessageInstance } from 'antd/es/message/interface';
import { type NotificationInstance } from 'antd/es/notification/interface';

export interface UseSingleRunnerDeps {
  /** Likes the user asked for (>= selected Pages); recorded as the run's target so a shortfall stays visible */
  requestedLikes: number;
  bmOverview: any;
  activeCookie: any;
  targetPostUrl: string;
  selectedPageIds: string[];
  scannedPages: FanpageItem[];
  selectedPageIdsSet: Set<string>;
  autoSkipAlreadyLiked: boolean;
  alreadyLikedPageIdsSet: Set<string>;
  parsedCommentLines: string[];
  commentListText: string;
  engagementMode: "LIKE_AND_COMMENT" | "LIKE_ONLY" | "COMMENT_ONLY";
  interactedPageIds: Set<string>;
  setRunTiming: Dispatch<SetStateAction<{ start: number; end: number; }>>;
  setLiveLogs: Dispatch<SetStateAction<string[]>>;
  setAutoBuffProgress: Dispatch<SetStateAction<AutoBuffProgress>>;
  setRunningTargetInfo: Dispatch<SetStateAction<{ url: string; reaction: string; count: number; startedAt: number; actorMode?: "VIAS" | "FANPAGES"; speedMode?: string; engagementMode?: string; }>>;
  selectedReaction: string;
  actorMode: "VIAS" | "FANPAGES";
  speedMode: SpeedModeKey;
  setActiveTabKey: (k: string) => void;
  setTargetPostUrl: Dispatch<SetStateAction<string>>;
  selectedAccountId: number | "CUSTOM" | "ALL_VIAS";
  fbAccounts: any[];
  currentViaAccount: any;
  buffAbortRef: MutableRefObject<AbortController>;
  autoFailoverLiveVia: boolean;
  alreadyLikedPagesForUrl: { pageId: string; pageName: string; reactionType: string; date: string; }[];
  delayMs: number;
  enableShare: boolean;
  enableHumanBehavior: boolean;
  fastSwitch: boolean;
  antiCheckpointGuard: boolean;
  concurrency: number;
  dripFeedMode: boolean;
  dripDurationMinutes: number;
  addLiveLog: (logMsg: string) => void;
  setInteractedPageIds: Dispatch<SetStateAction<Set<string>>>;
  addBuffLog: (log: BuffLogEntry) => void;
  message: MessageInstance;
  notification: NotificationInstance;
  runningTargetInfo: { url: string; reaction: string; count: number; startedAt: number; actorMode?: "VIAS" | "FANPAGES"; speedMode?: string; engagementMode?: string; };
  autoBuffProgress: AutoBuffProgress;
  queueItems: any[];
  fetchBuffQueue: () => Promise<void>;
  queryClient: QueryClient;
  initialFinishedRestoreDoneRef: MutableRefObject<boolean>;
}

/** Live single-link run over SSE: run mutation, stop, resume / top up likes, new campaign */
export function useSingleRunner(deps: UseSingleRunnerDeps) {
  const {
    requestedLikes,
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
  } = deps;

  // Every Via-group sessionId of the current run, so Stop can stop all groups running in parallel
  const runSessionIdsRef = useRef<Set<string>>(new Set());

  // Mutation: Auto Buff Like (Playwright Bot - Real-time SSE Stream)
  const autoBuffMutation = useMutation({
    mutationFn: async () => {
      if (bmOverview?.system?.isEmergencyStopped) {
        throw new Error('The system is in EMERGENCY STOP! Click the green "Resume operations" button at the top of the toolbar before starting.');
      }
      if (!activeCookie) {
        throw new Error('Please choose an account or paste a Facebook Cookie!');
      }
      if (!isFacebookPostUrl(targetPostUrl)) {
        throw new Error('Please enter a valid Facebook post link (https://facebook.com/...)');
      }
      if (selectedPageIds.length === 0) {
        throw new Error('Please choose at least 1 Fanpage to like with!');
      }

      let pagesToBuff = scannedPages.filter((p) => selectedPageIdsSet.has(p.id));

      if (autoSkipAlreadyLiked && alreadyLikedPageIdsSet.size > 0) {
        const filtered = pagesToBuff.filter((p) => !alreadyLikedPageIdsSet.has(p.id));
        if (filtered.length === 0) {
          throw new Error('Every Page you selected has already liked this post! Choose other Pages or turn off "Automatically skip Pages that already liked".');
        }
        pagesToBuff = filtered;
      }

      // In Comment-only mode, cap the Page count at the number of comment lines (avoids accidental repeat comments when hundreds of Pages are selected)
      const parsedCommentLines = commentListText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (engagementMode === 'COMMENT_ONLY' && parsedCommentLines.length > 0 && pagesToBuff.length > parsedCommentLines.length) {
        pagesToBuff = pagesToBuff.slice(0, parsedCommentLines.length);
      }

      const targetKpi = pagesToBuff.length;

      // SMART KPI AUTO-REFILL:
      // Prepare a backup pool of unselected Pages. If any Page in the main list fails,
      // the system automatically pulls a backup Page in its place until targetKpi successful likes are reached!
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
        message: 'Đã xếp hàng, đang chờ...',
      }));

      setRunTiming({ start: Date.now(), end: null });
      const initLog = `[${new Date().toLocaleTimeString('vi-VN')}] 🚀 Starting a ${targetKpi}-account engagement campaign for post: ${targetPostUrl.trim().slice(0, 45)}...`;
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

      // Lock the link at start time (the user may edit the link box while running)
      const runTargetUrl = targetPostUrl.trim();
      setRunningTargetInfo({
        url: runTargetUrl,
        reaction: selectedReaction,
        count: targetKpi,
        startedAt: Date.now(),
        actorMode,
        speedMode,
      });
      // Switch to the 'Live progress' tab automatically to follow along
      setActiveTabKey('buff-running');
      // Clear the link box on the New tab so the user can paste another link right away
      setTargetPostUrl('');
      const runAccountName =
        selectedAccountId === 'ALL_VIAS'
          ? `Tất cả Via (${fbAccounts.length} Via)`
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

      // Local copy of the progress: the setState updater only copies, no side effects
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
            pageName: patch.pageName || 'Page dự phòng',
            viaName: patch.viaName,
            status: patch.status || 'RUNNING',
            likeStatus: patch.likeStatus,
            commentStatus: patch.commentStatus,
            commentText: patch.commentText,
            message: patch.message || '⚡ Tự bù từ nhóm dự phòng để đạt KPI',
            error: patch.error,
          });
        }
      };

      // Run up to MAX_PARALLEL_VIAS Via groups in parallel (each Via still 1 thread; the backend also caps lanes).
      // Previously groups ran one after another, so a single-link run used only 1 Via at a time → ~2x slower than the Queue.
      // Only run in parallel when the backend can enforce the KPI across the whole run (older backends on client machines still run sequentially)
      const liveCaps: string[] = await axios
        .get(`${WORKER_BASE_URL}/api/buff-live/active`)
        .then((r) => r.data?.capabilities || [])
        .catch(() => []);
      const MAX_PARALLEL_VIAS = liveCaps.includes('RUN_KPI_CAP') ? 2 : 1;
      const activeSessionIds = new Set<string>();
      runSessionIdsRef.current = new Set();
      // Shared comment cursor: 2 Via groups running at once must not use the same lines in the same order
      let commentCursor = 0;
      const runGroup = async (gIdx: number, isFirstOfWorker: boolean): Promise<void> => {
        if (controller.signal.aborted) return;
        const currentCounts = summarizeBuffDetails(liveDetails);
        const currentDone = currentCounts.success + currentCounts.alreadyLiked;
        if (currentDone >= targetKpi) {
          console.log(`[LiveBuff] 🎯 Reached KPI ${currentDone}/${targetKpi} likes. Finishing early!`);
          return;
        }
        const remainingNeeded = Math.max(1, targetKpi - currentDone);
        const group = viaGroups[gIdx];

        // PRE-FLIGHT AUTO-FAILOVER CHECK: if this Via's cookie had already EXPIRED
        const isGroupExpired = group.pages.some((p) => isDeadViaStatus(p.viaStatus));
        if (autoFailoverLiveVia && isGroupExpired) {
          console.warn(`[AutoFailover] Via [${group.viaName}] cookie expired! Automatically topping up Pages from LIVE Vias...`);
          publish(`🛡️ [Tự dự phòng] Via [${group.viaName}] hết hạn cookie. Đang chuyển sang Page của các Via live...`);

          for (const p of group.pages) {
            patchDetail(p.id, {
              status: 'SKIPPED',
              message: `⚠️ Via [${group.viaName}] hết hạn cookie -> đã chuyển sang Page dự phòng của các Via live`,
            });
          }

          const alreadyUsedIds = new Set(liveDetails.map((d) => d.pageId));
          const availableLivePages = scannedPages.filter(
            (p) =>
              !isDeadViaStatus(p.viaStatus) &&
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
                message: `⚡ Tự bù thay cho Via hết hạn cookie [${group.viaName}]`,
              });
            }
            const failoverGroups = groupPagesByVia(replacementPages, activeCookie, 'Via Live Facebook');
            for (const fg of failoverGroups) {
              viaGroups.push(fg);
            }
            publish(undefined);
            return;
          }
        }

        if (!isFirstOfWorker) {
          publish(`Đang chuyển sang Via [${group.viaName}] (nghỉ an toàn 3s)...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (controller.signal.aborted) return;
        }

        const pageViaNameMap = new Map(group.pages.map((p) => [p.id, p.viaName]));
        const resolveEventViaName = (pageId?: string, evViaName?: string) =>
          evViaName || pageViaNameMap.get(String(pageId || '')) || group.viaName;

        const commentStart = commentCursor;
        commentCursor += group.pages.length;
        const selectedPagesPayload = group.pages.map((p, pIdx) => ({
          id: p.id,
          name: p.name,
          viaName: p.viaName || group.viaName,
          isProfile: p.isProfile ?? (actorMode === 'VIAS'),
          comment: commentLines.length > 0 ? commentLines[(commentStart + pIdx) % commentLines.length] : '',
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
          // The frontend saves 1 history record for the whole run (all Via groups merged) → the backend only saves a fallback when the browser has disconnected
          clientSavesLog: true,
        };

        const applyFinalDetails = (details: AutoBuffResultDetail[]) => {
          for (const d of details) {
            patchDetail(d.pageId, { ...d, viaName: resolveEventViaName(d.pageId, d.viaName) });
          }
        };

        activeSessionIds.add(payload.sessionId);
        runSessionIdsRef.current.add(payload.sessionId);
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
                  message: `[${eventViaName}] Opening post and engaging...`,
                });
                publish(`[${eventViaName}] ${ev.pageName}`);
                addLiveLog(`⚡ [${eventViaName}] Đang tương tác bằng: "${ev.pageName || ev.pageId}"`);
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

                // HARD CAP AGAINST OVERSHOOT: as soon as the KPI of new successful likes is reached, cut the stream and send the backend a stop command
                const freshCounts = summarizeBuffDetails(liveDetails);
                if (freshCounts.success >= targetKpi) {
                  addLiveLog(`🎯 [Đạt KPI] Đã đủ ${freshCounts.success}/${targetKpi} like! Dừng chiến dịch ngay để không bị vượt.`);
                  controller.abort();
                  // Stop every Via group running in parallel, not just the current one
                  for (const sid of activeSessionIds) {
                    axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`, { sessionId: sid }).catch(() => {});
                  }
                  return;
                }
              } else if (ev.type === 'COOLDOWN_START') {
                addLiveLog(`🛡️ [Via nghỉ] Tạm dừng ${ev.durationSec}s để bảo vệ tài khoản.`);
              } else if (ev.type === 'KPI_REACHED') {
                addLiveLog(`🎯 [Đạt KPI] Đã xong ${ev.success}/${ev.kpiTarget} like! Đã bù ${ev.autoRefilled || 0} Page lỗi.`);
              }
            },
            controller.signal
          );
          applyFinalDetails(result.details || []);
        } catch (streamErr: any) {
          const isCookieDead =
            !streamErr.receivedAny &&
            (/hết hạn|checkpoint|đăng nhập|xác minh|login|log in|expired|verif/i.test(streamErr.message) ||
              /network error/i.test(streamErr.message) ||
              group.pages.some((p) => isDeadViaStatus(p.viaStatus)));

          if (autoFailoverLiveVia && isCookieDead && !controller.signal.aborted) {
            console.warn(`[AutoFailover] Via [${group.viaName}] hit a cookie error mid-run. Automatically topping up Pages from LIVE Vias...`);
            publish(`🛡️ [Tự dự phòng] Via [${group.viaName}] lỗi cookie! Đang tự bù ${group.pages.length} Page từ các Via live...`);

            for (const p of group.pages) {
              const current = liveDetails.find((d) => d.pageId === p.id);
              if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
                patchDetail(p.id, {
                  status: 'SKIPPED',
                  message: `⚠️ Via [${group.viaName}] lỗi cookie -> đã chuyển sang Page dự phòng của các Via live`,
                  error: undefined,
                });
              }
            }

            const alreadyUsedIds = new Set(liveDetails.map((d) => d.pageId));
            const availableLivePages = scannedPages.filter(
              (p) =>
                !isDeadViaStatus(p.viaStatus) &&
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
                  message: `⚡ Tự bù thay cho Via hết hạn cookie [${group.viaName}]`,
                });
              }
              const failoverGroups = groupPagesByVia(replacementPages, activeCookie, 'Via Live Facebook');
              for (const fg of failoverGroups) {
                viaGroups.push(fg);
              }
            }
            finishedPagesCount = liveDetails.filter((d) => d.status !== 'WAITING' && d.status !== 'RUNNING').length;
            publish(undefined);
            return;
          }

          const canFallback = !streamErr.receivedAny && !controller.signal.aborted;
          if (canFallback) {
            // Stream couldn't start (old worker / proxy blocking SSE) → run the synchronous version exactly once
            console.warn(`Falling back to /api/buff-like for group ${group.viaName}:`, streamErr.message);
            try {
              const res = await axios.post(`${WORKER_BASE_URL}/api/buff-like`, payload, { signal: controller.signal });
              applyFinalDetails(res.data?.result?.details || []);
            } catch (syncErr: any) {
              const errData = syncErr.response?.data;
              if (errData?.cookieDead || /hết hạn|checkpoint|đăng nhập|xác minh|expired|log ?in|verif/i.test(errData?.error || syncErr.message)) {
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
            const isConnDrop = !streamErr.receivedAny || /ngắt|kết nối|network|abort|timeout|connection|disconnect|dropped/i.test(streamErr.message);
            const statusToSet = isAborted || isConnDrop ? 'SKIPPED' : 'ERROR';
            const reason = isAborted
              ? 'Đã dừng'
              : isConnDrop
              ? 'Chưa chạy: kết nối luồng bị ngắt (đã chuyển tiếp, hoặc bấm Chạy tiếp)'
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
        activeSessionIds.delete(payload.sessionId);
      };

      let nextGroupIdx = 0;
      const runWorker = async () => {
        let isFirst = true;
        while (!controller.signal.aborted) {
          const done = summarizeBuffDetails(liveDetails);
          if (done.success + done.alreadyLiked >= targetKpi) return;
          // Via groups added mid-run (Auto-Failover) are also picked up by any free worker
          const gIdx = nextGroupIdx++;
          if (gIdx >= viaGroups.length) return;
          await runGroup(gIdx, isFirst);
          isFirst = false;
        }
      };
      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(MAX_PARALLEL_VIAS, viaGroups.length)) }, () => runWorker())
      );

      buffAbortRef.current = null;
      return { details: [...liveDetails], runTargetUrl, runAccountName, runTargetKpi: targetKpi, runRequestedLikes: requestedLikes, stopped: controller.signal.aborted };
    },
    onSuccess: ({ details, runTargetUrl, runAccountName, runTargetKpi, runRequestedLikes, stopped }) => {
      const counts = summarizeBuffDetails(details);
      const hasAnyExecuted = details.some((d) => d.status !== 'WAITING');
      if (runTargetUrl && details.length > 0 && hasAnyExecuted) {
        // Pages still "waiting" when the run ended (e.g. KPI reached or Via stopped early) → mark Skipped instead of leaving "Queued, waiting..." in history
        const loggedDetails = details.map((d) =>
          d.status === 'WAITING' || d.status === 'RUNNING'
            ? { ...d, status: 'SKIPPED' as const, message: 'Chưa tới lượt (lượt chạy đã kết thúc trước)' }
            : d
        );
        const newLog: BuffLogEntry = {
          id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
          createdAt: new Date().toISOString(),
          type: 'SINGLE',
          targetUrl: runTargetUrl,
          reactionType: selectedReaction,
          totalPages: details.length,
          targetLikes: Math.max(runTargetKpi, runRequestedLikes),
          successCount: counts.success,
          alreadyLikedCount: counts.alreadyLiked,
          failedCount: counts.failed,
          engagementMode,
          commentCount: counts.comments,
          accountName: runAccountName,
          details: loggedDetails,
        };
        addBuffLog(newLog);
      }

      const hasConnInterrupted = details.some(
        (d) => d.status === 'SKIPPED' && /kết nối stream gián đoạn|stream connection interrupted/.test(String(d.message || ''))
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
        message.info(`Đã dừng. ${counts.success} thành công; các Page còn lại được bỏ qua. Đã lưu vào lịch sử.`);
      } else if (hasConnInterrupted) {
        message.warning(`Kết nối luồng bị ngắt ở ${counts.success} like. Phần còn lại đã chuyển vào Hàng đợi / bạn có thể bấm Chạy tiếp.`);
      } else {
        playVictoryChime();
        notification.success({
          message: '🎉 CHIẾN DỊCH BUFF HOÀN TẤT!',
          description: `Tương tác thành công ${counts.success}/${details.length} lượt (${Math.round((counts.success / Math.max(1, details.length)) * 100)}%). Báo cáo chi tiết đã gửi về Telegram!`,
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
    // Stop each Via group of this run (older backends can only stop by sessionId), then send the global stop command
    for (const sid of runSessionIdsRef.current) {
      axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`, { sessionId: sid }).catch(() => {});
    }
    axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`).catch(() => {});
    message.info('Đang dừng: worker sẽ dừng sau Page hiện tại.');
  };

  const [isResumingRemaining, setIsResumingRemaining] = useState(false);
  // State for the Resume modal
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [resumeTargetUrl, setResumeTargetUrl] = useState('');
  const [resumeDoneLikes, setResumeDoneLikes] = useState(0);
  const [resumeTargetLikes, setResumeTargetLikes] = useState(100);
  const [resumeMissingLikes, setResumeMissingLikes] = useState(66);
  const [resumeReaction, setResumeReaction] = useState('LIKE');

  const handleOpenResumeModal = (customLogParam?: any) => {
    // Guard against onClick={handleResumeRemaining} passing a React SyntheticEvent and corrupting the data
    const isEvent = customLogParam && (
      customLogParam.nativeEvent ||
      customLogParam._reactName ||
      typeof customLogParam.preventDefault === 'function' ||
      typeof customLogParam.stopPropagation === 'function'
    );
    const customLog = isEvent ? null : customLogParam;

    const targetUrl = customLog?.targetUrl || runningTargetInfo?.url || targetPostUrl;
    if (!targetUrl) {
      message.warning('Không tìm thấy link bài để chạy tiếp!');
      return;
    }

    // 1. Likes already done (prefer the passed-in log, then the current autoBuffProgress)
    const doneCount = customLog && typeof customLog.successCount === 'number'
      ? customLog.successCount
      : (autoBuffProgress.success || 0);

    // 2. Find the original target (Target Likes) - NEVER use totalPages (the whole fanpage pool) as the KPI target!
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
      message.loading({ content: `Đang thêm ${likesToBuff} like vào Hàng đợi...`, key: 'resume-rem' });
      await api.post('/buff-queue/add', {
        targetUrl: resumeTargetUrl,
        targetLikes: likesToBuff,
        reactionType: resumeReaction,
        delayMinutes: 0,
        source: 'MANUAL',
      });
      message.success({ content: `Đã thêm ${likesToBuff} like vào Hàng đợi! Đang bắt đầu chạy.`, key: 'resume-rem' });
      setResumeModalOpen(false);
      // Reset the form straight to IDLE so the UI reconnects and shows the Queue's Live Worker
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
      const errorMsg = err.response?.data?.error || err.message || 'Lỗi không xác định';
      message.error({ content: `Lỗi kích hoạt: ${errorMsg}`, key: 'resume-rem', duration: 6 });
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
    message.success('Đã xóa bảng tiến độ. Bạn có thể tạo chiến dịch mới!');
  };

  return {
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
  };
}
