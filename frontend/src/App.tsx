import React, { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, App as AntdApp, Layout, theme } from 'antd';
import type { ThemeConfig } from 'antd';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Header from './components/Header';
import Sidebar, { SidebarStats, SidebarDbStatus } from './components/Sidebar';
import BuffEngagement from './pages/BuffEngagement';
import api from './config/axios';
import { ThemeProvider } from './theme/ThemeContext';
import LoginPage, { CurrentUser } from './components/auth/LoginPage';

const { Content } = Layout;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

interface MainDashboardProps {
  currentUser: CurrentUser;
  onLogout: () => void;
}

const MainDashboard: React.FC<MainDashboardProps> = ({ currentUser, onLogout }) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });
  const [activeTabKey, setActiveTabKey] = useState<string>('buff-like');
  const [isExternalSettingsOpen, setIsExternalSettingsOpen] = useState(false);

  const [stats, setStats] = useState<SidebarStats>({
    queueCount: 0,
    historyCount: 0,
    monitorsCount: 0,
    accountsCount: 0,
  });

  const [dbStatus, setDbStatus] = useState<SidebarDbStatus>({
    connected: false,
    loading: true,
  });

  // Chỉ cập nhật state khi trạng thái DB thật sự thay đổi, tránh re-render toàn app mỗi lần poll
  const applyDbStatus = useCallback((next: SidebarDbStatus) => {
    setDbStatus((prev) =>
      prev.connected === next.connected &&
      prev.loading === next.loading &&
      prev.usingCache === next.usingCache &&
      prev.cachedCount === next.cachedCount &&
      prev.database === next.database &&
      prev.error === next.error
        ? prev
        : next
    );
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

  // Bấm nút kiểm tra thủ công: hiện loading
  const checkDb = useCallback(() => {
    fetchDbStatus(false);
  }, [fetchDbStatus]);

  useEffect(() => {
    fetchDbStatus(false);
    // Poll nền: không bật loading để không làm cả cây re-render khi DB không đổi
    const interval = setInterval(() => fetchDbStatus(true), 30000);
    return () => clearInterval(interval);
  }, [fetchDbStatus]);

  const handleSelectTab = useCallback((key: string) => setActiveTabKey(key), []);
  const handleToggleCollapse = useCallback(() => setCollapsed((prev) => !prev), []);
  const openViaManager = useCallback(() => setActiveTabKey('via-management'), []);
  const openSettings = useCallback(() => setActiveTabKey('system-settings'), []);

  const {
    data: accounts = [],
    isLoading: loadingAccounts,
    refetch: refetchAccounts,
  } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const res = await api.get('/connections');
      return res.data || [];
    },
  });

  // Cập nhật số tài khoản vào stats
  useEffect(() => {
    if (Array.isArray(accounts)) {
      setStats((prev) => ({ ...prev, accountsCount: accounts.length }));
    }
  }, [accounts]);

  return (
    <Layout className="min-h-screen !bg-app">
      {/* Ant Design Sidebar */}
      <Sidebar
        activeTabKey={activeTabKey}
        onSelectTab={handleSelectTab}
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        onOpenViaManager={openViaManager}
        onOpenSettings={openSettings}
        stats={stats}
        dbStatus={dbStatus}
        onCheckDb={checkDb}
      />

      {/* Main App Layout */}
      <Layout className="!bg-app flex flex-col min-h-screen">
        <Header
          activeTabKey={activeTabKey}
          onOpenViaManager={openViaManager}
          onOpenSettings={openSettings}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
          dbStatus={dbStatus}
          onCheckDb={checkDb}
          currentUser={currentUser}
          onLogout={onLogout}
        />

        <Content className="flex-1 p-3 sm:p-5 lg:p-6 overflow-y-auto">
          <BuffEngagement
            activeTabKey={activeTabKey}
            onTabChange={(key) => setActiveTabKey(key)}
            onOpenViaManager={() => setActiveTabKey('via-management')}
            onOpenSettings={() => setActiveTabKey('system-settings')}
            dbStatus={dbStatus}
            onCheckDb={checkDb}
            isExternalSettingsOpen={isExternalSettingsOpen}
            onCloseExternalSettings={() => setIsExternalSettingsOpen(false)}
            onStatsUpdate={(newStats) => {
              setStats((prev) => ({
                ...prev,
                ...newStats,
              }));
            }}
          />
        </Content>
      </Layout>
    </Layout>
  );
};

const DARK_THEME: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#06b6d4',
    colorBgBase: '#090d16',
    colorBgContainer: '#0f172a',
    colorBgElevated: '#1e293b',
    colorBorder: 'rgba(255, 255, 255, 0.08)',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.05)',
    colorText: '#f8fafc',
    colorTextSecondary: '#94a3b8',
    borderRadius: 12,
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  components: {
    Card: {
      colorBgContainer: '#0f172a',
      colorBorderSecondary: 'rgba(255, 255, 255, 0.08)',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(6, 182, 212, 0.16)',
      itemSelectedColor: '#22d3ee',
      itemHoverBg: 'rgba(255, 255, 255, 0.06)',
      itemHoverColor: '#f8fafc',
      itemActiveBg: 'transparent',
      itemMarginInline: 6,
      itemBorderRadius: 12,
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(6, 182, 212, 0.16)',
      darkItemSelectedColor: '#22d3ee',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
    },
    Layout: {
      siderBg: '#090d16',
      bodyBg: '#050811',
      headerBg: '#090d16',
    },
    Table: {
      headerBg: '#090d16',
      rowHoverBg: 'rgba(6, 182, 212, 0.06)',
    },
    Input: {
      colorBgContainer: '#090d16',
      activeBorderColor: '#06b6d4',
    },
  },
};

const ThemedApp: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    try {
      const saved = localStorage.getItem('viplike_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const handleLogout = useCallback(() => {
    localStorage.removeItem('viplike_token');
    localStorage.removeItem('viplike_user');
    setCurrentUser(null);
  }, []);

  return (
    <ConfigProvider theme={DARK_THEME}>
      <AntdApp>
        {!currentUser ? (
          <LoginPage onLoginSuccess={setCurrentUser} />
        ) : (
          <MainDashboard currentUser={currentUser} onLogout={handleLogout} />
        )}
      </AntdApp>
    </ConfigProvider>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
