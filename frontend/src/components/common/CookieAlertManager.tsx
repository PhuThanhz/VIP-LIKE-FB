import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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

/** Phát âm thanh cảnh báo bằng Web Audio API (không phụ thuộc file âm thanh bên ngoài) */
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

/** Helper gửi sự kiện cookie hết hạn từ bất kỳ đâu trong app */
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

        // Nếu phát hiện có Via mới bị chết mà trước đó chưa biết
        if (!isFirstLoadRef.current) {
          const newDead = incomingDeadVias.filter((v) => !knownDeadUidsRef.current.has(v.uid));
          if (newDead.length > 0) {
            playAlertSound();
            setIsModalOpen(true);
            setSelectedUidForUpdate(newDead[0].uid);

            notification.error({
              key: `dead-cookie-alert-${Date.now()}`,
              message: '🚨 CẢNH BÁO: COOKIE VIA ĐÃ HẾT HẠN!',
              description: (
                <div className="space-y-1">
                  <div>
                    Phát hiện <span className="font-bold text-rose-400">{newDead.length} Via</span> bị lỗi Cookie hoặc Checkpoint.
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
                      Cập nhật Cookie ngay
                    </Button>
                  </div>
                </div>
              ),
              placement: 'topRight',
              duration: 10,
            });
          }
        } else {
          // Lần đầu tải: nếu đã có Via chết sẵn, cảnh báo một lần để người dùng nắm bắt
          if (deadCount > 0) {
            notification.warning({
              key: 'init-dead-cookie-warning',
              message: '⚠️ Có Via cần cập nhật Cookie',
              description: `Hệ thống ghi nhận ${deadCount} Via đang bị hết hạn hoặc Checkpoint. Hãy cập nhật để tránh gián đoạn tương tác.`,
              placement: 'bottomRight',
              duration: 8,
              btn: (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => setIsModalOpen(true)}
                  icon={<ThunderboltOutlined />}
                >
                  Xem & Cập nhật
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
        console.warn('[CookieAlert] Lỗi kiểm tra cảnh báo cookie:', err?.message);
      }
    }
  }, [notification]);

  useEffect(() => {
    fetchAlerts(false);
    const timer = setInterval(() => fetchAlerts(true), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchAlerts]);

  // Lắng nghe sự kiện tức thì từ Buff Stream hoặc Queue Worker
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
        message: '🚨 COOKIE VIA VỪA HẾT HẠN TRONG LÚC TƯƠNG TÁC!',
        description: (
          <div className="space-y-1">
            <div className="font-semibold text-rose-400">
              {detail.viaName || `Via ${detail.uid}`} · {detail.isCheckpoint ? 'Checkpoint' : 'Hết hạn Cookie'}
            </div>
            <div className="text-xs text-slate-300">
              {detail.reason || 'Facebook đã chuyển hướng về trang đăng nhập hoặc yêu cầu xác minh bảo mật.'}
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
          message.success(res.data.message || 'Cập nhật Cookie mới thành công!');
          await fetchAlerts(true);
          return true;
        } else {
          message.error(res.data?.error || 'Không thể cập nhật cookie');
          return false;
        }
      } catch (err: any) {
        message.error(err.response?.data?.error || err.message || 'Lỗi khi cập nhật Cookie');
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
          ? 'Đang kiểm tra tính hợp lệ của Cookie trên Facebook...'
          : 'Đang kiểm tra hạn của toàn bộ dàn Via trên Facebook...',
        key: 'checkHealth',
      });
      try {
        const res = await api.post('/buff-vias/health-check', { cookieString, viaId, proxyUrl });
        if (res.data?.success) {
          if (cookieString) {
            const first = res.data.vias?.[0];
            if (first?.isLive) {
              message.success({
                content: `✅ Cookie CÒN HẠN (LIVE)! Nick: ${first.name || first.uid}`,
                key: 'checkHealth',
                duration: 4,
              });
            } else {
              message.error({
                content: `❌ Cookie ĐÃ HẾT HẠN hoặc CHECKPOINT: ${first?.error || first?.status}`,
                key: 'checkHealth',
                duration: 5,
              });
            }
          } else {
            message.success({
              content: `Kiểm tra hoàn tất: ${res.data.liveCount}/${res.data.total} Via còn LIVE hoạt động tốt!`,
              key: 'checkHealth',
              duration: 4,
            });
          }
          await fetchAlerts(true);
          return res.data;
        } else {
          message.error({ content: res.data?.error || 'Lỗi khi kiểm tra Cookie', key: 'checkHealth' });
          return null;
        }
      } catch (err: any) {
        message.error({
          content: err.response?.data?.error || err.message || 'Lỗi kiểm tra Cookie',
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

/** Banner cảnh báo ghim ở đầu trang */
export const CookieAlertBanner: React.FC = () => {
  const { totalDeadCount, deadVias, openModal } = useCookieAlert();
  const [dismissed, setDismissed] = useState(false);

  // Tự động hiện lại banner nếu số lượng via chết tăng lên
  const prevCountRef = useRef(totalDeadCount);
  useEffect(() => {
    if (totalDeadCount > prevCountRef.current) {
      setDismissed(false);
    }
    prevCountRef.current = totalDeadCount;
  }, [totalDeadCount]);

  if (totalDeadCount === 0 || dismissed) return null;

  const firstFew = deadVias.slice(0, 3).map((v) => v.viaName || v.uid).join(', ');
  const more = deadVias.length > 3 ? ` và ${deadVias.length - 3} Via khác` : '';

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
              Cảnh báo Cookie hết hạn:
            </span>
            <span className="text-rose-100">
              Có <strong className="text-amber-300 font-bold">{totalDeadCount} Via</strong> bị gián đoạn ({firstFew}{more}). Vui lòng cập nhật Cookie mới để tiếp tục tương tác!
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
            Cập nhật Cookie ngay
          </Button>
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => setDismissed(true)}
            className="!text-rose-300 hover:!text-white hover:!bg-rose-900/50"
            title="Tạm ẩn cảnh báo"
          />
        </div>
      </div>
    </div>
  );
};

/** Modal Popup Cảnh báo & Cập nhật nhanh Cookie */
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

  const [activeTab, setActiveTab] = useState<'list' | 'update' | 'check'>('list');
  const [cookieInputMode, setCookieInputMode] = useState<'xs_only' | 'full'>('xs_only');
  const [targetUid, setTargetUid] = useState<string>('');
  const [xsOnlyInput, setXsOnlyInput] = useState<string>('');
  const [newCookie, setNewCookie] = useState<string>('');
  const [newProxy, setNewProxy] = useState<string>('');
  const [updating, setUpdating] = useState<boolean>(false);
  const [testingUid, setTestingUid] = useState<string>('');

  // Tab 3: Kiểm tra Cookie bất kỳ
  const [testCookieInput, setTestCookieInput] = useState<string>('');
  const [testProxyInput, setTestProxyInput] = useState<string>('');
  const [testingStandalone, setTestingStandalone] = useState<boolean>(false);
  const [standaloneResult, setStandaloneResult] = useState<any>(null);

  useEffect(() => {
    if (open) {
      if (selectedUidForUpdate) {
        setTargetUid(selectedUidForUpdate);
        setActiveTab('update');
      } else if (deadVias.length > 0) {
        setTargetUid(deadVias[0].uid);
        setActiveTab('list');
      }
    }
  }, [open, selectedUidForUpdate, deadVias]);

  const handleStartUpdate = (uid: string) => {
    setTargetUid(uid);
    setActiveTab('update');
  };

  const handleDoUpdate = async () => {
    if (!targetUid.trim()) {
      return;
    }
    const payloadCookie = cookieInputMode === 'xs_only' ? xsOnlyInput.trim() : newCookie.trim();
    if (!payloadCookie) {
      return;
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
          <span>CẢNH BÁO: COOKIE VIA HẾT HẠN / CHECKPOINT</span>
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
                  Danh sách Via lỗi
                  {totalDeadCount > 0 && (
                    <Badge count={totalDeadCount} className="ml-1" overflowCount={99} />
                  )}
                </span>
              ),
              children: (
                <div className="space-y-4 pt-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-300">
                      Tự động kiểm tra phiên đăng nhập và bảo vệ tài khoản khi có sự cố.
                    </span>
                    <Button
                      size="small"
                      type="primary"
                      icon={<SafetyCertificateOutlined />}
                      loading={isCheckingHealth}
                      onClick={() => runHealthCheck()}
                      className="!bg-cyan-600 hover:!bg-cyan-500 font-medium text-xs shadow-md shrink-0"
                    >
                      🩺 Quét kiểm tra tất cả Via
                    </Button>
                  </div>

                  <Alert
                    type="error"
                    showIcon
                    message="Tương tác có thể bị gián đoạn"
                    description="Khi Cookie của Via bị hết hạn hoặc Facebook yêu cầu xác minh danh tính (Checkpoint), các tiến trình Like/Comment qua Via này sẽ tự động dừng để tránh bị Facebook khóa vĩnh viễn. Vui lòng cấp Cookie mới để tiếp tục."
                    className="!bg-rose-950/40 !border-rose-900/60 !text-rose-200"
                  />

                  {deadVias.length === 0 ? (
                    <div className="p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800">
                      <CheckCircleOutlined className="text-4xl text-emerald-400 mb-2" />
                      <div className="text-base font-semibold text-slate-200">
                        Tuyệt vời! Không có Via nào bị lỗi Cookie
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Tất cả các tài khoản Via trong hệ thống đang ở trạng thái hoạt động tốt.
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
                                  {isCheckpoint ? 'CHECKPOINT' : 'COOKIE HẾT HẠN'}
                                </Tag>
                                <span className="text-xs font-mono text-slate-400">UID: {via.uid}</span>
                              </div>
                              <div className="text-xs text-rose-300/90 leading-relaxed">
                                {matchingAlert?.reason ||
                                  (isCheckpoint
                                    ? 'Facebook yêu cầu xác minh bảo mật (Checkpoint). Cần mở trình duyệt gỡ lỗi và lấy cookie mới.'
                                    : 'Phiên đăng nhập đã kết thúc hoặc Cookie bị Facebook thu hồi.')}
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
                                Kiểm tra lại
                              </Button>
                              <Button
                                type="primary"
                                danger
                                size="small"
                                icon={<ThunderboltOutlined />}
                                onClick={() => handleStartUpdate(via.uid)}
                                className="font-medium"
                              >
                                Cập nhật Cookie
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
                      Làm mới danh sách
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
                          Quản lý Dàn Via
                        </Button>
                      )}
                      <Button
                        size="small"
                        onClick={() => {
                          dismissAlert(undefined, true);
                          onClose();
                        }}
                      >
                        Đóng
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
                  Cập nhật Cookie mới
                </span>
              ),
              children: (
                <div className="space-y-4 pt-1">
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Chọn Via cần cập nhật:
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {deadVias.map((v) => (
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
                          {v.viaName || v.uid} ({v.uid})
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      UID Tài Khoản:
                    </label>
                    <Input
                      value={targetUid}
                      onChange={(e) => setTargetUid(e.target.value.trim())}
                      placeholder="Nhập UID tài khoản (ví dụ: 100089123456789)"
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* CHỌN HÌNH THỨC NHẬP COOKIE */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-semibold text-slate-300">Hình thức cập nhật:</span>
                    <div className="flex gap-1.5">
                      <Button
                        size="small"
                        type={cookieInputMode === 'xs_only' ? 'primary' : 'default'}
                        onClick={() => setCookieInputMode('xs_only')}
                        className={cookieInputMode === 'xs_only' ? '!bg-cyan-600 font-semibold text-xs' : 'text-xs text-slate-400'}
                      >
                        ⚡ Chỉ nhập xs (Nhanh nhất)
                      </Button>
                      <Button
                        size="small"
                        type={cookieInputMode === 'full' ? 'primary' : 'default'}
                        onClick={() => setCookieInputMode('full')}
                        className={cookieInputMode === 'full' ? '!bg-cyan-600 font-semibold text-xs' : 'text-xs text-slate-400'}
                      >
                        📋 Dán cả chuỗi Cookie
                      </Button>
                    </div>
                  </div>

                  {cookieInputMode === 'xs_only' ? (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-200">
                          Mã phiên <code className="text-cyan-300 font-bold">xs</code> (Token Facebook mới): <span className="text-rose-400">*</span>
                        </label>
                        <span className="text-[11px] text-cyan-400 font-medium">Chỉ cần dán mỗi giá trị xs</span>
                      </div>
                      <TextArea
                        rows={3}
                        value={xsOnlyInput}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          const xsMatch = val.match(/(?:^|;\s*)xs=([^;]+)/)?.[1];
                          if (xsMatch) {
                            setXsOnlyInput(xsMatch);
                          } else {
                            setXsOnlyInput(val.replace(/^xs=/i, '').replace(/;$/, '').trim());
                          }
                        }}
                        placeholder="Ví dụ: 2%3A0UeZEJylLU5ccA%3A2%3A1793101411%3A-1%3A-1... (hoặc xs=2%3A...)"
                        className="font-mono text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl hover:border-cyan-500 focus:border-cyan-500"
                      />
                      <div className="mt-1.5 text-[11px] text-slate-400 flex items-start gap-1.5">
                        <span className="text-amber-400 font-bold shrink-0">💡 Gợi ý:</span>
                        <span>UID <b>({targetUid || 'Via'})</b> đã cố định sẵn. Bạn chỉ cần copy mỗi giá trị cookie <b>xs</b> từ trình duyệt dán vào đây, hệ thống sẽ tự động ghép với UID và khôi phục hoạt động ngay!</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-300">
                          Chuỗi Cookie Facebook mới:
                        </label>
                        <span className="text-[11px] text-slate-500">
                          c_user=...; xs=...; (hoặc dạng UID|PASS|2FA|COOKIE)
                        </span>
                      </div>
                      <TextArea
                        rows={4}
                        value={newCookie}
                        onChange={(e) => setNewCookie(e.target.value)}
                        placeholder="Dán chuỗi Cookie mới vào đây (c_user=...; xs=...; fr=...; datr=...)"
                        className="font-mono text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Proxy (tuỳ chọn - để trống nếu dùng chung Proxy cũ):
                    </label>
                    <Input
                      value={newProxy}
                      onChange={(e) => setNewProxy(e.target.value.trim())}
                      placeholder={
                        selectedViaInfo?.proxyUrl
                          ? `Proxy hiện tại: ${selectedViaInfo.proxyUrl}`
                          : 'http://username:password@ip:port (nếu có)'
                      }
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                    <Button onClick={() => setActiveTab('list')}>Quay lại danh sách</Button>
                    <Button
                      type="primary"
                      danger
                      loading={updating}
                      disabled={!targetUid.trim() || !(cookieInputMode === 'xs_only' ? xsOnlyInput.trim() : newCookie.trim())}
                      icon={<SafetyCertificateOutlined />}
                      onClick={handleDoUpdate}
                      className="font-semibold"
                    >
                      Xác minh & Lưu Cookie ngay
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
                  Kiểm tra Cookie bất kỳ
                </span>
              ),
              children: (
                <div className="space-y-4 pt-1">
                  <div className="text-xs text-slate-400 leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    💡 <strong>Kiểm tra tức thì:</strong> Dán chuỗi Cookie Facebook vào khung bên dưới để hệ thống mở phiên ẩn danh test xem Cookie còn hạn hoạt động (LIVE), đã hết hạn (EXPIRED) hay bị Checkpoint mà không làm ảnh hưởng hay lưu vào database.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Chuỗi Cookie cần kiểm tra:
                    </label>
                    <TextArea
                      rows={4}
                      value={testCookieInput}
                      onChange={(e) => setTestCookieInput(e.target.value)}
                      placeholder="Dán chuỗi Cookie Facebook vào đây (c_user=...; xs=...)"
                      className="font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Proxy kiểm tra (tuỳ chọn - nếu Cookie chạy qua Proxy riêng):
                    </label>
                    <Input
                      value={testProxyInput}
                      onChange={(e) => setTestProxyInput(e.target.value.trim())}
                      placeholder="http://username:password@ip:port (để trống nếu không dùng proxy)"
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button
                      icon={<SafetyCertificateOutlined />}
                      loading={isCheckingHealth}
                      onClick={() => runHealthCheck()}
                    >
                      🩺 Quét kiểm tra tất cả Via
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
                      Kiểm tra Cookie ngay
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
                            ✅ COOKIE CÒN HẠN (LIVE)
                          </Tag>
                        ) : (
                          <Tag color="error" className="font-bold text-xs py-0.5 px-2">
                            ❌ {standaloneResult.status === 'CHECKPOINT' ? 'BỊ CHECKPOINT' : 'COOKIE ĐÃ HẾT HẠN'}
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
                          <strong>Chi tiết phản hồi Facebook:</strong> {standaloneResult.error}
                        </div>
                      ) : (
                        <div className="text-xs text-emerald-300 mt-1">
                          Phiên đăng nhập Facebook hoàn toàn hợp lệ, có thể tương tác bình thường!
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
