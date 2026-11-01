import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { ConfigProvider, App as AntdApp, Layout, Spin } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Header from './components/Header';
import Sidebar, { SidebarStats } from './components/Sidebar';
import PageSkeleton from './components/common/SaaSLoadingSkeleton';
import api from './config/axios';
import { DEFAULT_NAV_KEY } from './config/navigation';
import { DARK_THEME } from './theme/antdTheme';
import { WallpaperProvider } from './theme/WallpaperContext';
import type { DbStatus } from './types/dbStatus';
import CookieAlertProvider, { CookieAlertBanner, useCookieAlert } from './components/common/CookieAlertManager';
import {
  AUTH_EXPIRED_EVENT,
  CurrentUser,
  CurrentUserContext,
  clearSession,
  getToken,
  saveUser,
} from './auth/session';

// Phân tách bundle (Code-splitting) tối ưu tốc độ tải trang ban đầu
const BuffEngagement = lazy(() => import('./pages/BuffEngagement'));
const LoginPage = lazy(() => import('./components/auth/LoginPage'));

const { Content } = Layout;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const DB_POLL_INTERVAL_MS = 30000;
const SIDER_COLLAPSED_KEY = 'viplike_sider_collapsed';

const getSavedCollapsed = () => localStorage.getItem(SIDER_COLLAPSED_KEY) === '1';

const isSameDbStatus = (a: DbStatus, b: DbStatus) =>
  a.connected === b.connected &&
  a.loading === b.loading &&
  a.usingCache === b.usingCache &&
  a.cachedCount === b.cachedCount &&
  a.database === b.database &&
  a.error === b.error;

const useDbStatus = () => {
  const [dbStatus, setDbStatus] = useState<DbStatus>({ connected: false, loading: true });

  // Chỉ cập nhật state khi trạng thái DB thật sự thay đổi, tránh re-render toàn app mỗi lần poll
  const applyDbStatus = useCallback((next: DbStatus) => {
    setDbStatus((prev) => (isSameDbStatus(prev, next) ? prev : next));
  }, []);

  const fetchDbStatus = useCallback(
    async (silent: boolean) => {
      try {
        if (!silent) setDbStatus((prev) => ({ ...prev, loading: true }));
        const res = await api.get('/db/test');
        if (res.data?.connected) {
          applyDbStatus({
            connected: true,
            usingCache: false,
            database: res.data.config?.database || 'viplike_radiant',
            loading: false,
          });
        } else {
          applyDbStatus({
            connected: false,
            usingCache: Boolean(res.data?.usingCache),
            cachedCount: res.data?.cachedCount || 0,
            loading: false,
            error: res.data?.error || 'Không kết nối được',
          });
        }
      } catch (err: any) {
        applyDbStatus({
          connected: false,
          loading: false,
          error: err.response?.data?.error || err.message,
        });
      }
    },
    [applyDbStatus]
  );

  useEffect(() => {
    fetchDbStatus(false);
    // Poll nền: không bật loading để không làm cả cây re-render khi DB không đổi
    const interval = setInterval(() => fetchDbStatus(true), DB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchDbStatus]);

  // Bấm nút kiểm tra thủ công: hiện loading
  const checkDb = useCallback(() => fetchDbStatus(false), [fetchDbStatus]);

  return { dbStatus, checkDb };
};

interface MainDashboardProps {
  currentUser: CurrentUser;
  onLogout: () => void;
}

const DashboardInner: React.FC<MainDashboardProps & { openViaManager: () => void; openSettings: () => void; activeTabKey: string; handleSelectTab: (k: string) => void }> = ({
  currentUser,
  onLogout,
  openViaManager,
  openSettings,
  activeTabKey,
  handleSelectTab,
}) => {
  const [collapsed, setCollapsed] = useState(getSavedCollapsed);
  const [stats, setStats] = useState<SidebarStats>({
    queueCount: 0,
    historyCount: 0,
    monitorsCount: 0,
    accountsCount: 0,
  });
  const { dbStatus, checkDb } = useDbStatus();
  const { totalDeadCount } = useCookieAlert();

  // Bấm tay: nhớ lựa chọn cho lần mở sau
  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(SIDER_COLLAPSED_KEY, prev ? '0' : '1');
      return !prev;
    });
  }, []);
  // Màn hình hẹp: luôn thu gọn; rộng lại thì trả về lựa chọn đã lưu
  const handleBreakpoint = useCallback((broken: boolean) => {
    setCollapsed(broken || getSavedCollapsed());
  }, []);
  const handleStatsUpdate = useCallback((newStats: SidebarStats) => {
    setStats((prev) => ({ ...prev, ...newStats }));
  }, []);

  return (
    <Layout className="min-h-screen !bg-transparent">
      <Sidebar
        activeTabKey={activeTabKey}
        onSelectTab={handleSelectTab}
        collapsed={collapsed}
        onBreakpoint={handleBreakpoint}
        stats={{ ...stats, deadViasCount: totalDeadCount }}
      />

      <Layout className="!bg-transparent flex flex-col min-h-screen">
        <CookieAlertBanner />
        <Header
          activeTabKey={activeTabKey}
          onOpenViaManager={openViaManager}
          onOpenSettings={openSettings}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
          currentUser={currentUser}
          onLogout={onLogout}
        />

        <Content className="flex-1 p-3 sm:p-5 lg:p-6 overflow-y-auto">
          {/* BuffEngagement tự đếm accountsCount từ danh sách tài khoản và báo lên qua onStatsUpdate */}
          <Suspense fallback={<PageSkeleton title="Đang tải giao diện Buff Tương Tác 2.0..." />}>
            <BuffEngagement
              activeTabKey={activeTabKey}
              onTabChange={handleSelectTab}
              onOpenViaManager={openViaManager}
              onOpenSettings={openSettings}
              dbStatus={dbStatus}
              onCheckDb={checkDb}
              onStatsUpdate={handleStatsUpdate}
            />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
};

const MainDashboard: React.FC<MainDashboardProps> = ({ currentUser, onLogout }) => {
  const [activeTabKey, setActiveTabKey] = useState<string>(DEFAULT_NAV_KEY);
  const handleSelectTab = useCallback((key: string) => setActiveTabKey(key), []);
  const openViaManager = useCallback(() => setActiveTabKey('via-management'), []);
  const openSettings = useCallback(() => setActiveTabKey('system-settings'), []);

  return (
    <CookieAlertProvider onNavigateToViaManager={openViaManager}>
      <DashboardInner
        currentUser={currentUser}
        onLogout={onLogout}
        openViaManager={openViaManager}
        openSettings={openSettings}
        activeTabKey={activeTabKey}
        handleSelectTab={handleSelectTab}
      />
    </CookieAlertProvider>
  );
};

const ThemedApp: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  const handleLogout = useCallback(() => {
    clearSession();
    setCurrentUser(null);
  }, []);

  const verifyAuth = useCallback(async () => {
    if (!getToken()) {
      setAuthChecking(false);
      return;
    }
    try {
      const res = await api.get('/auth/me');
      if (res.data?.authenticated && res.data?.user) {
        setCurrentUser(res.data.user);
        saveUser(res.data.user);
      } else {
        handleLogout();
      }
    } catch {
      handleLogout();
    } finally {
      setAuthChecking(false);
    }
  }, [handleLogout]);

  useEffect(() => {
    verifyAuth();
    const handleAuthExpired = () => setCurrentUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [verifyAuth]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center gap-3">
        <Spin size="large" />
        <span className="text-xs font-mono text-cyan-400">Đang xác thực phiên đăng nhập...</span>
      </div>
    );
  }

  return (
    <AntdApp>
      {!currentUser ? (
        <Suspense fallback={<div className="min-h-screen bg-[#090d16] flex items-center justify-center"><Spin size="large" /></div>}>
          <LoginPage onLoginSuccess={setCurrentUser} />
        </Suspense>
      ) : (
        <CurrentUserContext.Provider value={currentUser}>
          <MainDashboard currentUser={currentUser} onLogout={handleLogout} />
        </CurrentUserContext.Provider>
      )}
    </AntdApp>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={DARK_THEME}>
        <WallpaperProvider>
          <ThemedApp />
        </WallpaperProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
};

export default App;
