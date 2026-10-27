import React, { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, App as AntdApp, Layout, Spin } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Header from './components/Header';
import Sidebar, { SidebarStats } from './components/Sidebar';
import BuffEngagement from './pages/BuffEngagement';
import LoginPage from './components/auth/LoginPage';
import api from './config/axios';
import { DEFAULT_NAV_KEY } from './config/navigation';
import { DARK_THEME } from './theme/antdTheme';
import type { DbStatus } from './types/dbStatus';
import {
  AUTH_EXPIRED_EVENT,
  CurrentUser,
  CurrentUserContext,
  clearSession,
  getToken,
  saveUser,
} from './auth/session';

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
            database: res.data.config?.database || 'autopost_saas',
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

const MainDashboard: React.FC<MainDashboardProps> = ({ currentUser, onLogout }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState<string>(DEFAULT_NAV_KEY);
  const [stats, setStats] = useState<SidebarStats>({
    queueCount: 0,
    historyCount: 0,
    monitorsCount: 0,
    accountsCount: 0,
  });
  const { dbStatus, checkDb } = useDbStatus();

  const handleSelectTab = useCallback((key: string) => setActiveTabKey(key), []);
  const handleToggleCollapse = useCallback(() => setCollapsed((prev) => !prev), []);
  const openViaManager = useCallback(() => setActiveTabKey('via-management'), []);
  const openSettings = useCallback(() => setActiveTabKey('system-settings'), []);
  const handleStatsUpdate = useCallback((newStats: SidebarStats) => {
    setStats((prev) => ({ ...prev, ...newStats }));
  }, []);

  return (
    <Layout className="min-h-screen !bg-app">
      <Sidebar
        activeTabKey={activeTabKey}
        onSelectTab={handleSelectTab}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onToggleCollapse={handleToggleCollapse}
        stats={stats}
      />

      <Layout className="!bg-app flex flex-col min-h-screen">
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
          <BuffEngagement
            activeTabKey={activeTabKey}
            onTabChange={handleSelectTab}
            onOpenViaManager={openViaManager}
            onOpenSettings={openSettings}
            dbStatus={dbStatus}
            onCheckDb={checkDb}
            onStatsUpdate={handleStatsUpdate}
          />
        </Content>
      </Layout>
    </Layout>
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
        <LoginPage onLoginSuccess={setCurrentUser} />
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
        <ThemedApp />
      </ConfigProvider>
    </QueryClientProvider>
  );
};

export default App;
