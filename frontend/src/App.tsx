import React, { useState, useEffect } from 'react';
import { ConfigProvider, App as AntdApp, Layout, theme } from 'antd';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Header from './components/Header';
import Sidebar, { SidebarStats, SidebarDbStatus } from './components/Sidebar';
import BuffEngagement from './pages/BuffEngagement';
import api from './config/axios';

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

  const checkDb = async () => {
    try {
      setDbStatus((prev) => ({ ...prev, loading: true }));
      const res = await api.get('/db/test');
      if (res.data?.connected) {
        setDbStatus({
          connected: true,
          usingCache: false,
          database: res.data.config?.database || 'autopost_saas',
          loading: false,
        });
      } else {
        setDbStatus({
          connected: false,
          usingCache: Boolean(res.data?.usingCache),
          cachedCount: res.data?.cachedCount || 0,
          loading: false,
          error: res.data?.error || 'Không kết nối được',
        });
      }
    } catch (err: any) {
      setDbStatus({
        connected: false,
        loading: false,
        error: err.response?.data?.error || err.message,
      });
    }
  };

  useEffect(() => {
    checkDb();
    const interval = setInterval(checkDb, 30000);
    return () => clearInterval(interval);
  }, []);

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
    <Layout className="min-h-screen !bg-[#070b13]">
      {/* Ant Design Sidebar */}
      <Sidebar
        activeTabKey={activeTabKey}
        onSelectTab={(key) => setActiveTabKey(key)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        onOpenViaManager={() => setActiveTabKey('via-management')}
        onOpenSettings={() => setActiveTabKey('system-settings')}
        stats={stats}
        dbStatus={dbStatus}
        onCheckDb={checkDb}
      />

      {/* Main App Layout */}
      <Layout className="!bg-[#070b13] flex flex-col min-h-screen">
        <Header
          activeTabKey={activeTabKey}
          onOpenViaManager={() => setActiveTabKey('via-management')}
          onOpenSettings={() => setActiveTabKey('system-settings')}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
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

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
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
        }}
      >
        <AntdApp>
          <MainDashboard />
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
};

export default App;
