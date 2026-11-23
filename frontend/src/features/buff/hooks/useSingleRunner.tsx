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
} from '../utils';
import { triggerCookieExpiredAlert } from '../../../components/common/CookieAlertManager';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { type MessageInstance } from 'antd/es/message/interface';
import { type NotificationInstance } from 'antd/es/notification/interface';

export interface UseSingleRunnerDeps {
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

/** Lượt chạy trực tiếp 1 link qua SSE: mutation chạy, dừng, chạy tiếp / bù like, tạo chiến dịch mới */
export function useSingleRunner(deps: UseSingleRunnerDeps) {
  const {
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

  // Mọi sessionId nhóm Via của lượt chạy hiện tại, để nút Dừng dừng được tất cả nhóm đang chạy song song
  const runSessionIdsRef = useRef<Set<string>>(new Set());

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

      // Chạy song song tối đa MAX_PARALLEL_VIAS nhóm Via (mỗi Via vẫn 1 luồng như cũ; backend còn tự giới hạn số lane).
      // Trước đây các nhóm chạy lần lượt nên chạy 1 link chỉ dùng 1 Via tại một thời điểm → chậm ~2 lần so với Hàng đợi.
      // Chỉ chạy song song khi backend chặn được KPI theo cả lượt (backend cũ trên máy khách vẫn chạy tuần tự như trước)
      const liveCaps: string[] = await axios
        .get(`${WORKER_BASE_URL}/api/buff-live/active`)
        .then((r) => r.data?.capabilities || [])
        .catch(() => []);
      const MAX_PARALLEL_VIAS = liveCaps.includes('RUN_KPI_CAP') ? 2 : 1;
      const activeSessionIds = new Set<string>();
      runSessionIdsRef.current = new Set();
      // Con trỏ bình luận dùng chung: 2 nhóm Via chạy cùng lúc không được dùng trùng câu theo cùng thứ tự
      let commentCursor = 0;
      const runGroup = async (gIdx: number, isFirstOfWorker: boolean): Promise<void> => {
        if (controller.signal.aborted) return;
        const currentCounts = summarizeBuffDetails(liveDetails);
        const currentDone = currentCounts.success + currentCounts.alreadyLiked;
        if (currentDone >= targetKpi) {
          console.log(`[LiveBuff] 🎯 Đã đạt đủ KPI ${currentDone}/${targetKpi} like. Hoàn tất sớm!`);
          return;
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
            return;
          }
        }

        if (!isFirstOfWorker) {
          publish(`Chuyển sang Via [${group.viaName}] (nghỉ an toàn 3s)...`);
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
          // Frontend tự lưu 1 bản ghi lịch sử cho cả lượt chạy (gộp mọi nhóm Via) → backend chỉ lưu dự phòng khi trình duyệt đã ngắt kết nối
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
                  // Dừng mọi nhóm Via đang chạy song song, không chỉ nhóm hiện tại
                  for (const sid of activeSessionIds) {
                    axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`, { sessionId: sid }).catch(() => {});
                  }
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
            return;
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
        activeSessionIds.delete(payload.sessionId);
      };

      let nextGroupIdx = 0;
      const runWorker = async () => {
        let isFirst = true;
        while (!controller.signal.aborted) {
          const done = summarizeBuffDetails(liveDetails);
          if (done.success + done.alreadyLiked >= targetKpi) return;
          // Nhóm Via được thêm vào giữa chừng (Auto-Failover) cũng được worker còn rảnh lấy chạy tiếp
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
      return { details: [...liveDetails], runTargetUrl, runAccountName, runTargetKpi: targetKpi, stopped: controller.signal.aborted };
    },
    onSuccess: ({ details, runTargetUrl, runAccountName, runTargetKpi, stopped }) => {
      const counts = summarizeBuffDetails(details);
      const hasAnyExecuted = details.some((d) => d.status !== 'WAITING');
      if (runTargetUrl && details.length > 0 && hasAnyExecuted) {
        // Page còn "đang chờ" khi lượt đã kết thúc (vd: đã đủ KPI hoặc Via dừng sớm) → ghi là Bỏ qua thay vì treo "Đang xếp hàng chờ..." trong lịch sử
        const loggedDetails = details.map((d) =>
          d.status === 'WAITING' || d.status === 'RUNNING'
            ? { ...d, status: 'SKIPPED' as const, message: 'Không chạy tới (lượt chạy đã kết thúc trước)' }
            : d
        );
        const newLog: BuffLogEntry = {
          id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
          createdAt: new Date().toISOString(),
          type: 'SINGLE',
          targetUrl: runTargetUrl,
          reactionType: selectedReaction,
          totalPages: details.length,
          targetLikes: runTargetKpi,
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
    // Dừng từng nhóm Via của lượt này (kể cả backend cũ chỉ dừng được theo sessionId), rồi gửi lệnh dừng chung
    for (const sid of runSessionIdsRef.current) {
      axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`, { sessionId: sid }).catch(() => {});
    }
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
