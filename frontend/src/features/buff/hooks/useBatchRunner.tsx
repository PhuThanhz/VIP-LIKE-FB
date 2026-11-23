import {
  type AutoBuffResultDetail,
  type BatchOrder,
  type BuffLogEntry,
  type ViaGroup,
  type FanpageItem,
  type SpeedModeKey,
} from '../types';
import { ENGAGEMENT_STORAGE_KEY } from '../constants';
import api, { WORKER_BASE_URL } from '../../../config/axios';
import axios from 'axios';
import {
  groupPagesByVia,
  isFacebookPostUrl,
  playVictoryChime,
  runBuffStream,
  summarizeBuffDetails,
} from '../utils';
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { type MessageInstance } from 'antd/es/message/interface';
import { type NotificationInstance } from 'antd/es/notification/interface';

export interface UseBatchRunnerDeps {
  setViewProgress: Dispatch<SetStateAction<{ total: number; done: number; status: "IDLE" | "RUNNING" | "DONE"; }>>;
  targetViews: number;
  targetViewUrl: string;
  viewConcurrency: number;
  watchTimeSeconds: number;
  message: MessageInstance;
  setTargetPostUrl: Dispatch<SetStateAction<string>>;
  setSelectedReaction: Dispatch<SetStateAction<string>>;
  targetPostUrl: string;
  selectedReaction: string;
  activeCookie: any;
  scanPagesMutation: UseMutationResult<any, any, string, unknown>;
  selectedPageIds: string[];
  autoBuffMutation: UseMutationResult<{ details: AutoBuffResultDetail[]; runTargetUrl: string; runAccountName: any; stopped: boolean; }, any, void, unknown>;
  parsedBatchLinks: string[];
  scannedPages: FanpageItem[];
  selectedPageIdsSet: Set<string>;
  autoFailoverLiveVia: boolean;
  actorMode: "VIAS" | "FANPAGES";
  batchLikesPerOrder: number;
  autoSkipAlreadyLiked: boolean;
  fetchInteractedPageIdsForUrl: (rawUrl: string) => Promise<Set<string>>;
  commentListText: string;
  selectedAccountId: number | "CUSTOM" | "ALL_VIAS";
  fbAccounts: any[];
  setRunTiming: Dispatch<SetStateAction<{ start: number; end: number; }>>;
  setBatchOrders: Dispatch<SetStateAction<BatchOrder[]>>;
  setIsBatchRunning: Dispatch<SetStateAction<boolean>>;
  setIsBatchPaused: Dispatch<SetStateAction<boolean>>;
  batchAbortRef: MutableRefObject<boolean>;
  batchPauseRef: MutableRefObject<boolean>;
  setActiveTabKey: (k: string) => void;
  batchStreamAbortControllersRef: MutableRefObject<Set<AbortController>>;
  delayMs: number;
  speedMode: SpeedModeKey;
  engagementMode: "LIKE_AND_COMMENT" | "LIKE_ONLY" | "COMMENT_ONLY";
  enableShare: boolean;
  enableHumanBehavior: boolean;
  fastSwitch: boolean;
  antiCheckpointGuard: boolean;
  concurrency: number;
  dripFeedMode: boolean;
  dripDurationMinutes: number;
  addBuffLog: (log: BuffLogEntry) => void;
  batchLinkConcurrency: number;
  batchWaitSeconds: 2;
  notification: NotificationInstance;
  isBatchPaused: boolean;
  setBuffMode: Dispatch<SetStateAction<"SINGLE" | "BATCH">>;
  setSelectedAccountId: Dispatch<SetStateAction<number | "CUSTOM" | "ALL_VIAS">>;
  handleSelectRandomPages: (count: number) => void;
  batchOrders: BatchOrder[];
  setBatchLinksText: Dispatch<SetStateAction<string>>;
  setBatchLikesPerOrder: Dispatch<SetStateAction<number>>;
}

/** Khởi chạy buff: buff view, quét Fanpage, chạy ngay 1 link, chạy hàng loạt (batch) với tạm dừng/dừng/bù like */
export function useBatchRunner(deps: UseBatchRunnerDeps) {
  const {
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
  } = deps;

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


  return {
    handleScanPages,
    handleStartAutoBuff,
    handleStartBatchBuff,
    handleStopBatchBuff,
    handleRefillSingleOrder,
    handleRefillBatchIncomplete,
  };
}
