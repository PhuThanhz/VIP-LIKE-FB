import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { WORKER_BASE_URL } from '../../../config/axios';
import { useVisibleInterval } from '../../../hooks/useVisibleInterval';
import type { BuffMonitor } from '../types';

/** Hàng đợi buff: 3s khi có bài đang chạy, 8s khi rảnh; dừng khi ẩn tab */
export function useBuffQueue() {
  const [queueItems, setQueueItems] = useState<any[]>([]);

  const fetchBuffQueue = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-queue/list`);
      if (res.data?.success) {
        setQueueItems(res.data.queue || []);
      }
    } catch {}
  }, []);

  // Chỉ phụ thuộc vào cờ "có bài đang chạy" (boolean), không phụ thuộc mảng queueItems:
  // trước đây mỗi lần fetch tạo mảng mới → effect chạy lại → fetch ngay → vòng lặp gọi API liên tục.
  const queueHasRunning = queueItems.some((i) => i.status === 'RUNNING');
  useEffect(() => {
    fetchBuffQueue();
  }, [fetchBuffQueue]);
  useVisibleInterval(fetchBuffQueue, queueHasRunning ? 3000 : 8000);

  return { queueItems, fetchBuffQueue };
}

/** Mục tiêu Post Hunter + cờ tạm dừng toàn cục; 15s một lần */
export function useBuffMonitors() {
  const [monitors, setMonitors] = useState<BuffMonitor[]>([]);
  const [postHunterPaused, setPostHunterPaused] = useState<boolean>(false);

  const fetchBuffMonitors = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-monitors`);
      if (res.data?.success) {
        setMonitors(res.data.monitors || []);
        setPostHunterPaused(Boolean(res.data.postHunterPaused));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBuffMonitors();
  }, [fetchBuffMonitors]);
  useVisibleInterval(fetchBuffMonitors, 15000);

  return { monitors, postHunterPaused, setPostHunterPaused, fetchBuffMonitors };
}

/** Tổng quan dàn Via / BM (sức khoẻ, chống trùng, trạng thái hệ thống); 15s một lần */
export function useBmOverview() {
  const [bmOverview, setBmOverview] = useState<any>(null);

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

  useEffect(() => {
    fetchBmOverview();
  }, [fetchBmOverview]);
  useVisibleInterval(fetchBmOverview, 15000);

  return { bmOverview, fetchBmOverview };
}

/** Cấu hình hệ thống (Telegram, tốc độ, bảo vệ Via…); tải một lần khi mở trang */
export function useSystemSettings() {
  const [systemSettings, setSystemSettings] = useState<any>({
    telegramBotToken: '',
    telegramBotTokenMasked: '',
    telegramChatId: '',
    notifyOnViaDead: true,
    notifyOnHunter: true,
    notifyOnBuffDone: true,
    maxDailyPageActions: 25,
  });

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-settings`);
      if (res.data?.success && res.data.settings) {
        setSystemSettings(res.data.settings);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { systemSettings, setSystemSettings, fetchSettings };
}
