import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { WORKER_BASE_URL } from '../../../config/axios';
import { useVisibleInterval } from '../../../hooks/useVisibleInterval';
import type { BuffMonitor } from '../types';

/** Buff queue: every 3s while a post is running, 8s when idle; stops while the tab is hidden */
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

  // Depends only on the "a post is running" flag (boolean), not on the queueItems array:
  // previously each fetch created a new array → effect re-ran → fetched immediately → endless API call loop.
  const queueHasRunning = queueItems.some((i) => i.status === 'RUNNING');
  useEffect(() => {
    fetchBuffQueue();
  }, [fetchBuffQueue]);
  useVisibleInterval(fetchBuffQueue, queueHasRunning ? 3000 : 8000);

  return { queueItems, fetchBuffQueue };
}

/** Post Hunter monitors + global pause flag; every 15s */
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

/** Via / BM fleet overview (health, dedupe, system status); every 15s */
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

/** System config (Telegram, speed, Via protection…); loaded once when the page opens */
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
