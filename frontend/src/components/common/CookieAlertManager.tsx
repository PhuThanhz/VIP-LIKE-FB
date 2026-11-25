import { offerTopUpAfterCookieUpdate } from '../../utils/topUp';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Modal, Tabs, Alert, Input, Button, Tag, Space, Typography, Table, Badge, App } from 'antd';
import {
  WarningFilled,
  AlertOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  CloseOutlined,
  KeyOutlined,
  ExclamationCircleOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import api from '../../config/axios';
import { useVisibleInterval } from '../../hooks/useVisibleInterval';
import { parseFacebookCookie } from '../../utils/cookieHelper';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

export interface DeadViaItem {
  id: number | string;
  uid: string;
  viaName?: string;
  tokenStatus: string;
  proxyUrl?: string;
  lastCheckedAt?: string;
}

export interface CookieAlertItem {
  id: string;
  uid: string;
  viaName: string;
  status: string;
  reason: string;
  detectedAt: string;
  isRead: boolean;
}

export interface CookieAlertContextType {
  alerts: CookieAlertItem[];
  deadVias: DeadViaItem[];
  totalDeadCount: number;
  unreadCount: number;
  isModalOpen: boolean;
  selectedUidForUpdate: string;
  openModal: (uid?: string) => void;
  closeModal: () => void;
  dismissAlert: (id?: string, all?: boolean) => Promise<void>;
  quickUpdateCookie: (uid: string, cookieString: string, proxyUrl?: string) => Promise<boolean>;
  refreshAlerts: () => Promise<void>;
  isCheckingHealth: boolean;
  runHealthCheck: (cookieString?: string, viaId?: string | number, proxyUrl?: string) => Promise<any>;
}

const CookieAlertContext = createContext<CookieAlertContextType | null>(null);

export const useCookieAlert = () => {
  const ctx = useContext(CookieAlertContext);
  if (!ctx) {
    throw new Error('useCookieAlert must be used within a CookieAlertProvider');
  }
  return ctx;
};

/** Plays an alert sound with the Web Audio API (no external audio file needed) */
export const playAlertSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12); // E5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.24); // A5

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {}
};

/** Helper to emit a cookie-expired event from anywhere in the app */
export const triggerCookieExpiredAlert = (detail: {
  uid: string;
  viaName?: string;
  reason?: string;
  isCheckpoint?: boolean;
}) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cookie_expired', { detail }));
  }
};

const POLL_INTERVAL_MS = 15000;

export const CookieAlertProvider: React.FC<{
  children: React.ReactNode;
  onNavigateToViaManager?: () => void;
}> = ({ children, onNavigateToViaManager }) => {
  const { notification, message } = App.useApp();
  const [alerts, setAlerts] = useState<CookieAlertItem[]>([]);
  const [deadVias, setDeadVias] = useState<DeadViaItem[]>([]);
  const [totalDeadCount, setTotalDeadCount] = useState<number>(0);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [selectedUidForUpdate, setSelectedUidForUpdate] = useState<string>('');
  const knownDeadUidsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef<boolean>(true);

  const fetchAlerts = useCallback(async (silent = true) => {
    try {
      const res = await api.get('/buff-vias/alerts');
      if (res.data?.success) {
        const incomingDeadVias: DeadViaItem[] = res.data.deadVias || [];
        const incomingAlerts: CookieAlertItem[] = res.data.recentAlerts || [];
        const deadCount = res.data.totalDeadCount || incomingDeadVias.length;
        const unread = res.data.unreadAlertsCount || 0;

        setDeadVias(incomingDeadVias);
        setAlerts(incomingAlerts);
        setTotalDeadCount(deadCount);
        setUnreadCount(unread);

        const currentUids = new Set(incomingDeadVias.map((v) => v.uid));

        // If a newly dead Via is detected that we didn't know about before
        if (!isFirstLoadRef.current) {
          const newDead = incomingDeadVias.filter((v) => !knownDeadUidsRef.current.has(v.uid));
          if (newDead.length > 0) {
            playAlertSound();
            setIsModalOpen(true);
            setSelectedUidForUpdate(newDead[0].uid);

            notification.error({
              key: `dead-cookie-alert-${Date.now()}`,
              message: '🚨 WARNING: VIA COOKIE EXPIRED!',
              description: (
                <div className="space-y-1">
                  <div>
                    Detected <span className="font-bold text-rose-400">{newDead.length} Vias</span> with a Cookie error or Checkpoint.
                  </div>
                  <div className="text-xs text-slate-400">
                    {newDead.map((v) => `${v.viaName || v.uid} (${v.tokenStatus})`).join(', ')}
                  </div>
                  <div className="pt-1">
                    <Button
                      size="small"
                      type="primary"
                      danger
                      icon={<ThunderboltOutlined />}
                      onClick={() => {
                        setSelectedUidForUpdate(newDead[0].uid);
                        setIsModalOpen(true);
                      }}
                    >
                      Update Cookie now
                    </Button>
                  </div>
                </div>
              ),
              placement: 'topRight',
              duration: 10,
            });
          }
        } else {
          // First load: if some Vias are already dead, warn once so the user knows
          if (deadCount > 0) {
            notification.warning({
              key: 'init-dead-cookie-warning',
              message: '⚠️ Some Vias need a Cookie update',
              description: `${deadCount} Vias are expired or checkpointed. Update them to avoid interrupting engagement.`,
              placement: 'bottomRight',
              duration: 8,
              btn: (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => setIsModalOpen(true)}
                  icon={<ThunderboltOutlined />}
                >
                  View & Update
                </Button>
              ),
            });
          }
          isFirstLoadRef.current = false;
        }

        knownDeadUidsRef.current = currentUids;
      }
    } catch (err: any) {
      if (!silent) {
        console.warn('[CookieAlert] Failed to check cookie alerts:', err?.message);
      }
    }
  }, [notification]);

  useEffect(() => {
    fetchAlerts(false);
  }, [fetchAlerts]);
  useVisibleInterval(() => fetchAlerts(true), POLL_INTERVAL_MS);

  // Listen for instant events from the Buff Stream or Queue Worker
  useEffect(() => {
    const handleImmediateDead = (evt: Event) => {
      const custom = evt as CustomEvent<{
        uid?: string;
        viaName?: string;
        reason?: string;
        isCheckpoint?: boolean;
      }>;
      const detail = (custom.detail || {}) as {
        uid?: string;
        viaName?: string;
        reason?: string;
        isCheckpoint?: boolean;
      };
      playAlertSound();
      if (detail.uid) {
        setSelectedUidForUpdate(detail.uid);
      }
      setIsModalOpen(true);

      notification.error({
        key: `immediate-cookie-dead-${detail.uid || Date.now()}`,
        message: '🚨 A VIA COOKIE JUST EXPIRED DURING ENGAGEMENT!',
        description: (
          <div className="space-y-1">
            <div className="font-semibold text-rose-400">
              {detail.viaName || `Via ${detail.uid}`} · {detail.isCheckpoint ? 'Checkpoint' : 'Cookie expired'}
            </div>
            <div className="text-xs text-slate-300">
              {detail.reason || 'Facebook redirected to the login page or asked for a security check.'}
            </div>
          </div>
        ),
        placement: 'topRight',
        duration: 0,
      });

      fetchAlerts(true);
    };

    window.addEventListener('cookie_expired', handleImmediateDead);
    return () => window.removeEventListener('cookie_expired', handleImmediateDead);
  }, [fetchAlerts, notification]);

  const openModal = useCallback((uid?: string) => {
    if (uid) setSelectedUidForUpdate(uid);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const dismissAlert = useCallback(async (id?: string, all = false) => {
    try {
      await api.post('/buff-vias/alerts/dismiss', { id, all });
      setAlerts((prev) => (all ? [] : prev.filter((a) => a.id !== id)));
      setUnreadCount(0);
    } catch {}
  }, []);

  const quickUpdateCookie = useCallback(
    async (uid: string, cookieString: string, proxyUrl?: string) => {
      try {
        const res = await api.post('/buff-vias/quick-update-cookie', {
          uid,
          cookieString,
          proxyUrl,
        });
        if (res.data?.success) {
          message.success(res.data.message || 'New Cookie saved!');
          await fetchAlerts(true);
          offerTopUpAfterCookieUpdate();
          return true;
        } else {
          message.error(res.data?.error || 'Could not update the cookie');
          return false;
        }
      } catch (err: any) {
        message.error(err.response?.data?.error || err.message || 'Error updating the Cookie');
        return false;
      }
    },
    [fetchAlerts, message]
  );

  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);

  const runHealthCheck = useCallback(
    async (cookieString?: string, viaId?: string | number, proxyUrl?: string) => {
      setIsCheckingHealth(true);
      message.loading({
        content: cookieString
          ? 'Checking the Cookie on Facebook...'
          : 'Checking every Via on Facebook...',
        key: 'checkHealth',
      });
      try {
        const res = await api.post('/buff-vias/health-check', { cookieString, viaId, proxyUrl });
        if (res.data?.success) {
          if (cookieString) {
            const first = res.data.vias?.[0];
            if (first?.isLive) {
              message.success({
                content: `✅ Cookie is VALID (LIVE)! Account: ${first.name || first.uid}`,
                key: 'checkHealth',
                duration: 4,
              });
            } else {
              message.error({
                content: `❌ Cookie EXPIRED or CHECKPOINT: ${first?.error || first?.status}`,
                key: 'checkHealth',
                duration: 5,
              });
            }
          } else {
            message.success({
              content: `Check complete: ${res.data.liveCount}/${res.data.total} Vias are LIVE and healthy!`,
              key: 'checkHealth',
              duration: 4,
            });
          }
          await fetchAlerts(true);
          return res.data;
        } else {
          message.error({ content: res.data?.error || 'Error checking the Cookie', key: 'checkHealth' });
          return null;
        }
      } catch (err: any) {
        message.error({
          content: err.response?.data?.error || err.message || 'Cookie check error',
          key: 'checkHealth',
        });
        return null;
      } finally {
        setIsCheckingHealth(false);
      }
    },
    [fetchAlerts, message]
  );

  return (
    <CookieAlertContext.Provider
      value={{
        alerts,
        deadVias,
        totalDeadCount,
        unreadCount,
        isModalOpen,
        selectedUidForUpdate,
        openModal,
        closeModal,
        dismissAlert,
        quickUpdateCookie,
        refreshAlerts: fetchAlerts,
        isCheckingHealth,
        runHealthCheck,
      }}
    >
      {children}
      <CookieAlertModal
        open={isModalOpen}
        onClose={closeModal}
        onNavigateToViaManager={onNavigateToViaManager}
      />
    </CookieAlertContext.Provider>
  );
};

/** Warning banner pinned at the top of the page */
export const CookieAlertBanner: React.FC = () => {
  const { totalDeadCount, deadVias, openModal } = useCookieAlert();
  const [dismissed, setDismissed] = useState(false);

  // Show the banner again if the number of dead vias goes up
  const prevCountRef = useRef(totalDeadCount);
  useEffect(() => {
    if (totalDeadCount > prevCountRef.current) {
      setDismissed(false);
    }
    prevCountRef.current = totalDeadCount;
  }, [totalDeadCount]);

  if (totalDeadCount === 0 || dismissed) return null;

  const firstFew = deadVias.slice(0, 3).map((v) => v.viaName || v.uid).join(', ');
  const more = deadVias.length > 3 ? ` and ${deadVias.length - 3} more Vias` : '';

  return (
    <div className="relative z-30 bg-gradient-to-r from-rose-950/90 via-red-900/80 to-amber-950/90 border-b border-rose-600/40 px-4 py-2.5 shadow-lg backdrop-blur-md animate-in fade-in duration-300">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5 min-w-0 text-rose-200">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
          </span>
          <WarningFilled className="text-amber-400 text-base shrink-0" />
          <div className="truncate">
            <span className="font-bold text-white uppercase tracking-wide mr-1.5">
              Cookie expiry warning:
            </span>
            <span className="text-rose-100">
              <strong className="text-amber-300 font-bold">{totalDeadCount} Vias</strong> are interrupted ({firstFew}{more}). Please update their Cookies to continue engaging!
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="small"
            type="primary"
            danger
            icon={<ThunderboltOutlined />}
            onClick={() => openModal()}
            className="!font-semibold shadow-md !bg-rose-600 hover:!bg-rose-500 !border-rose-400"
          >
            Update Cookie now
          </Button>
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => setDismissed(true)}
            className="!text-rose-300 hover:!text-white hover:!bg-rose-900/50"
            title="Hide warning for now"
          />
        </div>
      </div>
    </div>
  );
};

/** Warning & quick Cookie update popup modal */
export const CookieAlertModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onNavigateToViaManager?: () => void;
}> = ({ open, onClose, onNavigateToViaManager }) => {
  const {
    deadVias,
    alerts,
    totalDeadCount,
    selectedUidForUpdate,
    quickUpdateCookie,
    refreshAlerts,
    dismissAlert,
    isCheckingHealth,
    runHealthCheck,
  } = useCookieAlert();

  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<'list' | 'update' | 'check'>('list');
  const [cookieInputMode, setCookieInputMode] = useState<'xs_only' | 'full'>('full');
  const [targetUid, setTargetUid] = useState<string>('');
  const [xsOnlyInput, setXsOnlyInput] = useState<string>('');
  const [newCookie, setNewCookie] = useState<string>('');
  const [newProxy, setNewProxy] = useState<string>('');
  const [updating, setUpdating] = useState<boolean>(false);
  const [testingUid, setTestingUid] = useState<string>('');

  // Tab 3: check any Cookie
  const [testCookieInput, setTestCookieInput] = useState<string>('');
  const [testProxyInput, setTestProxyInput] = useState<string>('');
  const [testingStandalone, setTestingStandalone] = useState<boolean>(false);
  const [standaloneResult, setStandaloneResult] = useState<any>(null);

  const cookieTextAreaRef = useRef<any>(null);
  const wasOpenRef = useRef<boolean>(false);
  const deadViasRef = useRef<DeadViaItem[]>(deadVias);
  deadViasRef.current = deadVias;

  // Only initialize the form when the modal just opened (false → true), not on every 15s poll
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setCookieInputMode('full');
    if (selectedUidForUpdate) {
      setTargetUid(selectedUidForUpdate);
      setActiveTab('update');
    } else if (deadViasRef.current.length > 0) {
      setTargetUid(deadViasRef.current[0].uid);
      setActiveTab('list');
    }
  }, [open, selectedUidForUpdate]);

  // While open, if another Via just died (selectedUid changed) → switch to that Via
  const prevSelectedRef = useRef<string>(selectedUidForUpdate);
  useEffect(() => {
    if (open && selectedUidForUpdate && selectedUidForUpdate !== prevSelectedRef.current) {
      setTargetUid(selectedUidForUpdate);
      setActiveTab('update');
    }
    prevSelectedRef.current = selectedUidForUpdate;
  }, [open, selectedUidForUpdate]);

  // Auto-focus the cookie paste box when entering the update tab
  useEffect(() => {
    if (open && activeTab === 'update' && cookieInputMode === 'full') {
      const t = setTimeout(() => cookieTextAreaRef.current?.focus?.(), 150);
      return () => clearTimeout(t);
    }
  }, [open, activeTab, cookieInputMode]);

  const parsedFull = useMemo(() => parseFacebookCookie(newCookie), [newCookie]);
  const fullReady = Boolean(parsedFull.c_user && parsedFull.xs);
  const uidMismatch = Boolean(parsedFull.c_user && targetUid && parsedFull.c_user !== targetUid.trim());

  const handleStartUpdate = (uid: string) => {
    setTargetUid(uid);
    setActiveTab('update');
  };

  const handleDoUpdate = async () => {
    if (!targetUid.trim()) {
      return;
    }
    const rawVal = cookieInputMode === 'xs_only' ? xsOnlyInput.trim() : newCookie.trim();
    if (!rawVal) {
      return;
    }
    const parsed = parseFacebookCookie(rawVal);
    let payloadCookie = '';
    if (parsed.isJson || parsed.valid) {
      payloadCookie = parsed.cookieString;
    } else if (cookieInputMode === 'xs_only') {
      const cleanXs = rawVal.replace(/^xs=/i, '').replace(/;$/, '').trim();
      payloadCookie = `c_user=${targetUid.trim()}; xs=${cleanXs};`;
    } else {
      payloadCookie = rawVal;
    }

    setUpdating(true);
    try {
      const success = await quickUpdateCookie(targetUid.trim(), payloadCookie, newProxy.trim());
      if (success) {
        setXsOnlyInput('');
        setNewCookie('');
        setNewProxy('');
        if (deadVias.length <= 1) {
          onClose();
        } else {
          setActiveTab('list');
        }
      }
    } finally {
      setUpdating(false);
    }
  };

  const selectedViaInfo = deadVias.find((v) => v.uid === targetUid);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      centered
      className="cookie-alert-modal"
      title={
        <div className="flex items-center gap-2.5 text-rose-400 font-bold text-base sm:text-lg">
          <span className="p-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-400 inline-flex items-center justify-center">
            <WarningFilled />
          </span>
          <span>WARNING: VIA COOKIE EXPIRED / CHECKPOINT</span>
        </div>
      }
    >
      <div className="pt-2">
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as any)}
          items={[
            {
              key: 'list',
              label: (
                <span className="flex items-center gap-1.5 font-medium">
                  <AlertOutlined />
                  Vias with errors
                  {totalDeadCount > 0 && (
                    <Badge count={totalDeadCount} className="ml-1" overflowCount={99} />
                  )}
                </span>
              ),
              children: (
                <div className="space-y-4 pt-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-300">
                      Automatically checks login sessions and protects accounts when something goes wrong.
                    </span>
                    <Button
                      size="small"
                      type="primary"
                      icon={<SafetyCertificateOutlined />}
                      loading={isCheckingHealth}
                      onClick={() => runHealthCheck()}
                      className="!bg-cyan-600 hover:!bg-cyan-500 font-medium text-xs shadow-md shrink-0"
                    >
                      🩺 Check all Vias
                    </Button>
                  </div>

                  <Alert
                    type="error"
                    showIcon
                    message="Engagement may be interrupted"
                    description="When a Via's Cookie expires or Facebook asks for identity verification (Checkpoint), Like/Comment runs through that Via stop automatically to avoid a permanent Facebook lock. Please provide a new Cookie to continue."
                    className="!bg-rose-950/40 !border-rose-900/60 !text-rose-200"
                  />

                  {deadVias.length === 0 ? (
                    <div className="p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800">
                      <CheckCircleOutlined className="text-4xl text-emerald-400 mb-2" />
                      <div className="text-base font-semibold text-slate-200">
                        Great! No Vias have Cookie errors
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Every Via account in the system is healthy.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                      {deadVias.map((via) => {
                        const matchingAlert = alerts.find((a) => a.uid === via.uid);
                        const isCheckpoint =
                          via.tokenStatus === 'CHECKPOINT' || matchingAlert?.status === 'CHECKPOINT';

                        return (
                          <div
                            key={via.uid}
                            className="p-3.5 rounded-xl border border-rose-900/50 bg-gradient-to-r from-rose-950/30 to-slate-900/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:border-rose-700/60 transition-colors"
                          >
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-100 text-sm">
                                  {via.viaName || `Via ${via.uid}`}
                                </span>
                                <Tag color={isCheckpoint ? 'volcano' : 'red'} className="!m-0 font-mono text-[11px]">
                                  {isCheckpoint ? 'CHECKPOINT' : 'COOKIE EXPIRED'}
                                </Tag>
                                <span className="text-xs font-mono text-slate-400">UID: {via.uid}</span>
                              </div>
                              <div className="text-xs text-rose-300/90 leading-relaxed">
                                {matchingAlert?.reason ||
                                  (isCheckpoint
                                    ? 'Facebook requires a security check (Checkpoint). Open a debug browser and grab a new cookie.'
                                    : 'The login session ended or Facebook revoked the Cookie.')}
                              </div>
                              {via.proxyUrl && (
                                <div className="text-[11px] font-mono text-slate-500 truncate">
                                  Proxy: {via.proxyUrl}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                size="small"
                                icon={<SafetyCertificateOutlined />}
                                loading={testingUid === via.uid}
                                onClick={async () => {
                                  setTestingUid(via.uid);
                                  try {
                                    await runHealthCheck(undefined, via.id, via.proxyUrl);
                                  } finally {
                                    setTestingUid('');
                                  }
                                }}
                                className="!text-cyan-400 !border-cyan-800/80 hover:!border-cyan-500"
                              >
                                Recheck
                              </Button>
                              <Button
                                type="primary"
                                danger
                                size="small"
                                icon={<ThunderboltOutlined />}
                                onClick={() => handleStartUpdate(via.uid)}
                                className="font-medium"
                              >
                                Update Cookie
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => refreshAlerts()}
                      className="!text-slate-400"
                    >
                      Refresh list
                    </Button>

                    <Space>
                      {onNavigateToViaManager && (
                        <Button
                          size="small"
                          icon={<LinkOutlined />}
                          onClick={() => {
                            onClose();
                            onNavigateToViaManager();
                          }}
                        >
                          Manage Vias
                        </Button>
                      )}
                      <Button
                        size="small"
                        onClick={() => {
                          dismissAlert(undefined, true);
                          onClose();
                        }}
                      >
                        Close
                      </Button>
                    </Space>
                  </div>
                </div>
              ),
            },
            {
              key: 'update',
              label: (
                <span className="flex items-center gap-1.5 font-medium">
                  <KeyOutlined />
                  Update Cookie
                </span>
              ),
              children: (
                <div className="space-y-4 pt-1">
                  {(() => {
                    const chips = [...deadVias];
                    if (targetUid && !chips.some((v) => v.uid === targetUid)) {
                      chips.unshift({ id: targetUid, uid: targetUid, tokenStatus: 'EXPIRED' });
                    }
                    if (chips.length <= 1) return null;
                    return (
                      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
                        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                          Choose the Via to update:
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {chips.map((v) => (
                            <button
                              key={v.uid}
                              type="button"
                              onClick={() => setTargetUid(v.uid)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                targetUid === v.uid
                                  ? 'bg-rose-600 text-white shadow-md border border-rose-400'
                                  : 'bg-slate-800/80 text-slate-300 border border-slate-700/60 hover:border-slate-500'
                              }`}
                            >
                              {v.viaName || v.uid} {v.viaName ? `(${v.uid})` : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Account UID{selectedViaInfo?.viaName ? ` · ${selectedViaInfo.viaName}` : ''}:
                    </label>
                    <Input
                      value={targetUid}
                      onChange={(e) => setTargetUid(e.target.value.trim())}
                      placeholder="Enter the account UID (e.g. 100089123456789)"
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* COOKIE INPUT METHOD */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-300">Update method:</span>
                    <div className="flex gap-1.5">
                      <Button
                        size="small"
                        type={cookieInputMode === 'full' ? 'primary' : 'default'}
                        onClick={() => setCookieInputMode('full')}
                        className={cookieInputMode === 'full' ? '!bg-cyan-600 font-semibold text-xs' : 'text-xs text-slate-400'}
                      >
                        📋 Paste J2TEAM JSON / Cookie (Recommended)
                      </Button>
                      <Button
                        size="small"
                        type={cookieInputMode === 'xs_only' ? 'primary' : 'default'}
                        onClick={() => setCookieInputMode('xs_only')}
                        className={cookieInputMode === 'xs_only' ? '!bg-cyan-600 font-semibold text-xs' : 'text-xs text-slate-400'}
                      >
                        ⚡ xs only
                      </Button>
                    </div>
                  </div>

                  {cookieInputMode === 'full' ? (
                    <div>
                      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                        <label className="text-xs font-semibold text-slate-200">
                          New Facebook Cookie: <span className="text-rose-400">*</span>
                        </label>
                        <span className="text-[11px] text-slate-500">
                          J2TEAM Cookies · Cookie-Editor · c_user=…; xs=… string
                        </span>
                      </div>
                      <div className="mb-2 text-[11px] text-slate-400 leading-relaxed">
                        <span className="text-amber-400 font-semibold">How to get it: </span>
                        Log in to the account in a browser → open <b>facebook.com</b> → click the <b>J2TEAM Cookies</b> extension → <b>Export</b> (copy) → paste the whole block below.
                      </div>
                      <TextArea
                        ref={cookieTextAreaRef}
                        rows={6}
                        value={newCookie}
                        onChange={(e) => setNewCookie(e.target.value)}
                        placeholder={'Ctrl+V the whole JSON block here, e.g.:\n{"url":"https://www.facebook.com","cookies":[{"name":"c_user","value":"…"},{"name":"xs","value":"…"}, …]}'}
                        className="font-mono text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl hover:border-cyan-500 focus:border-cyan-500"
                      />

                      {newCookie.trim() && (
                        <div
                          className={`mt-2 p-3 rounded-xl border text-xs space-y-1.5 ${
                            fullReady && !uidMismatch
                              ? 'bg-emerald-950/30 border-emerald-700/50'
                              : 'bg-amber-950/30 border-amber-700/50'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            {fullReady && !uidMismatch ? (
                              <Tag color="success" className="!m-0 font-semibold">✅ Valid cookie, ready to save</Tag>
                            ) : (
                              <Tag color="warning" className="!m-0 font-semibold">
                                ⚠️{' '}
                                {!parsedFull.c_user && !parsedFull.xs
                                  ? 'Cookie not readable yet'
                                  : !parsedFull.xs
                                  ? 'Missing xs'
                                  : !parsedFull.c_user
                                  ? 'Missing c_user'
                                  : 'UID mismatch'}
                              </Tag>
                            )}
                            <span className="text-slate-400">
                              {parsedFull.isJson ? 'JSON' : 'Cookie string'} · {parsedFull.cookieCount} cookies
                            </span>
                          </div>
                          <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
                            <span className="text-slate-500">c_user</span>
                            <span className={parsedFull.c_user ? 'text-slate-200' : 'text-rose-400'}>
                              {parsedFull.c_user || 'none'}
                            </span>
                            <span className="text-slate-500">xs</span>
                            <span className={`truncate ${parsedFull.xs ? 'text-slate-200' : 'text-rose-400'}`}>
                              {parsedFull.xs ? `${parsedFull.xs.slice(0, 18)}…` : 'none'}
                            </span>
                          </div>
                          {uidMismatch && (
                            <div className="flex items-center justify-between gap-2 flex-wrap text-amber-200">
                              <span>
                                This cookie belongs to UID <b className="font-mono">{parsedFull.c_user}</b>, not <b className="font-mono">{targetUid}</b>.
                              </span>
                              <Button size="small" onClick={() => setTargetUid(parsedFull.c_user)}>
                                Use UID {parsedFull.c_user}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-200">
                          Session token <code className="text-cyan-300 font-bold">xs</code>: <span className="text-rose-400">*</span>
                        </label>
                        <span className="text-[11px] text-slate-500">Keeps only c_user + xs, more likely to hit a checkpoint</span>
                      </div>
                      <TextArea
                        rows={3}
                        value={xsOnlyInput}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          const parsed = parseFacebookCookie(val);
                          if (parsed.isJson) {
                            // JSON pasted into the xs box → switch to full mode to keep every cookie
                            setNewCookie(val);
                            setXsOnlyInput('');
                            setCookieInputMode('full');
                            message.info('JSON Cookie detected, switched to full paste mode');
                            return;
                          }
                          const xsMatch = val.match(/(?:^|;\s*)xs=([^;]+)/)?.[1];
                          setXsOnlyInput(xsMatch || val.replace(/^xs=/i, '').replace(/;$/, '').trim());
                        }}
                        placeholder="e.g. 2%3A0UeZEJylLU5ccA%3A2%3A1793101411%3A-1%3A-1..."
                        className="font-mono text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl hover:border-cyan-500 focus:border-cyan-500"
                      />
                      <div className="mt-1.5 text-[11px] text-slate-400">
                        Will be saved as <code>c_user={targetUid || 'UID'}; xs=…</code>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Proxy (optional - leave empty to keep the current Proxy):
                    </label>
                    <Input
                      value={newProxy}
                      onChange={(e) => setNewProxy(e.target.value.trim())}
                      placeholder={
                        selectedViaInfo?.proxyUrl
                          ? `Current proxy: ${selectedViaInfo.proxyUrl}`
                          : 'http://username:password@ip:port (if any)'
                      }
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                    <Button onClick={() => setActiveTab('list')}>Back to list</Button>
                    <Button
                      type="primary"
                      danger
                      loading={updating}
                      disabled={!targetUid.trim() || (cookieInputMode === 'xs_only' ? !xsOnlyInput.trim() : !fullReady || uidMismatch)}
                      icon={<SafetyCertificateOutlined />}
                      onClick={handleDoUpdate}
                      className="font-semibold"
                    >
                      Verify & Save Cookie
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'check',
              label: (
                <span className="flex items-center gap-1.5 font-medium">
                  <SafetyCertificateOutlined />
                  Check any Cookie
                </span>
              ),
              children: (
                <div className="space-y-4 pt-1">
                  <div className="text-xs text-slate-400 leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    💡 <strong>Instant check:</strong> Paste a Facebook Cookie string (or a whole Cookie-Editor JSON block) below and the system opens an incognito session to test whether the Cookie is still valid (LIVE), expired (EXPIRED) or checkpointed, without affecting or saving anything to the database.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Cookie string to check:
                    </label>
                    <TextArea
                      rows={4}
                      value={testCookieInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        const parsed = parseFacebookCookie(val);
                        if (parsed.isJson) {
                          setTestCookieInput(parsed.cookieString);
                          message.success(`JSON Cookie detected (${parsed.cookieCount} cookies)`);
                        } else {
                          setTestCookieInput(val);
                        }
                      }}
                      placeholder="Paste a Facebook Cookie string or Cookie-Editor JSON here"
                      className="font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Test proxy (optional - if the Cookie runs through its own Proxy):
                    </label>
                    <Input
                      value={testProxyInput}
                      onChange={(e) => setTestProxyInput(e.target.value.trim())}
                      placeholder="http://username:password@ip:port (leave empty if no proxy)"
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button
                      icon={<SafetyCertificateOutlined />}
                      loading={isCheckingHealth}
                      onClick={() => runHealthCheck()}
                    >
                      🩺 Check all Vias
                    </Button>
                    <Button
                      type="primary"
                      icon={<SafetyCertificateOutlined />}
                      loading={testingStandalone}
                      disabled={!testCookieInput.trim()}
                      onClick={async () => {
                        setTestingStandalone(true);
                        setStandaloneResult(null);
                        try {
                          const res = await runHealthCheck(testCookieInput.trim(), undefined, testProxyInput.trim());
                          if (res?.vias?.[0]) {
                            setStandaloneResult(res.vias[0]);
                          }
                        } finally {
                          setTestingStandalone(false);
                        }
                      }}
                      className="!bg-cyan-600 hover:!bg-cyan-500 font-semibold shadow-md"
                    >
                      Check Cookie now
                    </Button>
                  </div>

                  {standaloneResult && (
                    <div
                      className={`p-4 rounded-xl border transition-all ${
                        standaloneResult.isLive
                          ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                          : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        {standaloneResult.isLive ? (
                          <Tag color="success" className="font-bold text-xs py-0.5 px-2">
                            ✅ COOKIE IS VALID (LIVE)
                          </Tag>
                        ) : (
                          <Tag color="error" className="font-bold text-xs py-0.5 px-2">
                            ❌ {standaloneResult.status === 'CHECKPOINT' ? 'CHECKPOINTED' : 'COOKIE EXPIRED'}
                          </Tag>
                        )}
                        {standaloneResult.name && (
                          <span className="font-bold text-slate-100 text-sm">{standaloneResult.name}</span>
                        )}
                        {standaloneResult.uid && (
                          <span className="text-xs font-mono text-slate-400">UID: {standaloneResult.uid}</span>
                        )}
                      </div>

                      {standaloneResult.error ? (
                        <div className="text-xs text-rose-300 mt-1 leading-relaxed">
                          <strong>Facebook response details:</strong> {standaloneResult.error}
                        </div>
                      ) : (
                        <div className="text-xs text-emerald-300 mt-1">
                          The Facebook login session is fully valid and can engage normally!
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    </Modal>
  );
};

export default CookieAlertProvider;
