import React, { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, App as AntdApp, Layout, theme } from 'antd';
import type { ThemeConfig } from 'antd';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Header from './components/Header';
import Sidebar, { SidebarStats, SidebarDbStatus } from './components/Sidebar';
import BuffEngagement from './pages/BuffEngagement';
import api from './config/axios';
import { ThemeProvider, useThemeMode } from './theme/ThemeContext';

const { Content } = Layout;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const MainDashboard: React.FC = () => {
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
    colorPrimary: '#38bdf8',
    colorBgBase: '#070b13',
    colorBgContainer: '#0c1220',
    colorBorder: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  components: {
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(56, 189, 248, 0.14)',
      itemSelectedColor: '#38bdf8',
      itemHoverBg: 'rgba(255, 255, 255, 0.045)',
      itemHoverColor: '#f8fafc',
      itemActiveBg: 'transparent',
      itemMarginInline: 6,
      itemBorderRadius: 12,
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(56, 189, 248, 0.14)',
      darkItemSelectedColor: '#38bdf8',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.045)',
    },
    Layout: {
      siderBg: '#070b13',
      bodyBg: '#070b13',
      headerBg: '#070b13',
    },
  },
};

const LIGHT_THEME: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#2563eb',
    colorBgBase: '#f5f7fb',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#e2e8f0',
    colorBorderSecondary: '#eef2f7',
    colorText: '#0f172a',
    colorTextSecondary: '#475569',
    borderRadius: 12,
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  components: {
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#eff6ff',
      itemSelectedColor: '#2563eb',
      itemHoverBg: '#f1f5f9',
      itemHoverColor: '#0f172a',
      itemActiveBg: 'transparent',
      itemColor: '#475569',
      itemMarginInline: 6,
      itemBorderRadius: 12,
    },
    Layout: {
      siderBg: '#ffffff',
      bodyBg: '#f5f7fb',
      headerBg: '#ffffff',
    },
  },
};

const ThemedApp: React.FC = () => {
  const { isLight } = useThemeMode();
  return (
    <ConfigProvider theme={isLight ? LIGHT_THEME : DARK_THEME}>
      <AntdApp>
        <MainDashboard />
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
