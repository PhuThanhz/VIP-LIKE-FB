import React from 'react';
import { Layout, Menu, Badge, Tag, Tooltip, Button } from 'antd';
import type { MenuProps } from 'antd';
import {
  ThunderboltFilled,
  ThunderboltOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  IdcardOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DatabaseOutlined,
  SyncOutlined,
  KeyOutlined,
  PictureOutlined,
} from '@ant-design/icons';


import { useThemeMode } from '../theme/ThemeContext';

const { Sider } = Layout;

export interface SidebarStats {
  queueCount?: number;
  historyCount?: number;
  monitorsCount?: number;
  accountsCount?: number;
}

export interface SidebarDbStatus {
  connected: boolean;
  usingCache?: boolean;
  cachedCount?: number;
  loading: boolean;
  database?: string;
  error?: string;
}

interface SidebarProps {
  activeTabKey: string;
  onSelectTab: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenViaManager: () => void;
  onOpenSettings: () => void;
  stats?: SidebarStats;
  dbStatus?: SidebarDbStatus;
  onCheckDb?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTabKey,
  onSelectTab,
  collapsed,
  onToggleCollapse,
  onOpenViaManager,
  onOpenSettings,
  stats = {},
  dbStatus = { connected: false, loading: false },
  onCheckDb,
}) => {
  const { isLight } = useThemeMode();
  const menuItems: MenuProps['items'] = [
    {
      key: 'buff-like',
      icon: <ThunderboltOutlined className="text-base text-cyan-400" />,
      label: 'Like & Bình Luận',
    },
    {
      key: 'buff-view',
      icon: <PlayCircleOutlined className="text-base text-purple-400" />,
      label: 'Tăng View Video/Reels',
    },
    {
      key: 'post-hunter',
      icon: <SearchOutlined className="text-base text-emerald-400" />,
      label: (
        <div className="flex items-center justify-between w-full">
          <span>Tự Săn Bài Mới</span>
          {Boolean(stats.monitorsCount && stats.monitorsCount > 0) && (
            <Tag color="cyan" className="ml-auto text-[10px] font-mono rounded-full px-1.5 py-0 border-0 leading-tight">
              {stats.monitorsCount}
            </Tag>
          )}
        </div>
      ),
    },
    {
      key: 'buff-queue',
      icon: <ClockCircleOutlined className="text-base text-amber-400" />,
      label: (
        <div className="flex items-center justify-between w-full">
          <span>Hàng Đợi Tự Động</span>
          {Boolean(stats.queueCount && stats.queueCount > 0) && (
            <Badge count={stats.queueCount} overflowCount={99} size="small" className="ml-auto" />
          )}
        </div>
      ),
    },
    {
      key: 'buff-history',
      icon: <HistoryOutlined className="text-base text-blue-400" />,
      label: (
        <div className="flex items-center justify-between w-full">
          <span>Nhật Ký & Lịch Sử</span>
          {Boolean(stats.historyCount && stats.historyCount > 0) && (
            <span className="text-[10px] text-slate-500 font-mono ml-auto">
              {stats.historyCount}
            </span>
          )}
        </div>
      ),
    },
    {
      type: 'divider',
      className: 'my-2 border-slate-800/80',
    },
    {
      key: 'via-management',
      icon: <IdcardOutlined className="text-base text-sky-400" />,
      label: (
        <div className="flex items-center justify-between w-full">
          <span>Dàn Via & Cookie</span>
          {Boolean(stats.accountsCount && stats.accountsCount > 0) && (
            <Tag color="blue" className="ml-auto text-[10px] font-mono rounded-full px-1.5 py-0 border-0 leading-tight">
              {stats.accountsCount} nick
            </Tag>
          )}
        </div>
      ),
    },
    {
      key: 'avatar-studio',
      icon: <PictureOutlined className="text-base text-pink-400" />,
      label: (
        <div className="flex items-center justify-between w-full">
          <span>Cập Nhật Avatar Page</span>
          <Tag color="magenta" className="ml-auto text-[10px] font-mono rounded-full px-1.5 py-0 border-0 leading-tight">
            MỚI
          </Tag>
        </div>
      ),
    },
    {
      key: 'system-settings',
      icon: <SettingOutlined className="text-base text-slate-400" />,
      label: 'Cấu Hình & Telegram',
    },
    {
      key: 'license-management',
      icon: <KeyOutlined className="text-base text-amber-400" />,
      label: (
        <div className="flex items-center justify-between w-full">
          <span>Cho Thuê & Bản Quyền</span>
          <Tag color="gold" className="ml-auto text-[10px] font-mono rounded-full px-1.5 py-0 border-0 leading-tight">
            SaaS
          </Tag>
        </div>
      ),
    },
  ];

  const handleMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    // Xoá browser focus trên element vừa click để tránh highlight bị dính lại
    try {
      if (domEvent?.currentTarget && typeof (domEvent.currentTarget as any).blur === 'function') {
        (domEvent.currentTarget as any).blur();
      }
    } catch {}

    onSelectTab(key as string);
  };

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={onToggleCollapse}
      trigger={null}
      width={260}
      collapsedWidth={76}
      className="!bg-app border-r border-slate-800/80 flex flex-col justify-between select-none z-30 transition-all duration-300"
      style={{
        position: 'sticky',
        top: 0,
        height: '100vh',
        left: 0,
      }}
    >
      <div className="flex flex-col h-full">
        {/* Brand Header */}
        <div className="h-16 flex items-center px-4 border-b border-slate-800/80 shrink-0">
          <div className="flex items-center gap-3 w-full overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-500 p-0.5 shadow-md shadow-cyan-500/20 shrink-0 flex items-center justify-center">
              <div className="w-full h-full bg-slate-950/90 rounded-[10px] flex items-center justify-center">
                <ThunderboltFilled className="text-lg text-cyan-400 animate-pulse" />
              </div>
            </div>

            {!collapsed && (
              <div className="flex flex-col min-w-0 transition-opacity duration-200">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black tracking-wider bg-gradient-to-r from-cyan-400 via-blue-300 to-indigo-300 bg-clip-text text-transparent truncate uppercase">
                    VIPLIKE RADIANT
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-cyan-950/90 text-cyan-300 border border-cyan-800/60 shrink-0">
                    v2.0
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 truncate">
                  Buff Like & Săn Bài Meta
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Ant Design Navigation Menu */}
        <div className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          <Menu
            theme={isLight ? 'light' : 'dark'}
            mode="inline"
            selectedKeys={[activeTabKey]}
            items={menuItems}
            onClick={handleMenuClick}
            className="!bg-transparent !border-0 text-xs font-semibold px-2 space-y-1"
          />
        </div>

        {/* Bottom Status & Collapse Toggle */}
        <div className="p-3 border-t border-slate-800/80 shrink-0 space-y-2 bg-slate-950/40">
          {/* MySQL Status Pill */}
          {!collapsed ? (
            <Tooltip
              title={
                dbStatus.connected
                  ? `Đã kết nối MySQL Workbench (${dbStatus.database || 'autopost_saas'})`
                  : dbStatus.usingCache
                  ? `Đang dùng Bộ Nhớ Đệm (${dbStatus.cachedCount || 0} Via). Nhấp để kết nối lại MySQL.`
                  : 'MySQL chưa kết nối. Nhấp để thử kết nối lại.'
              }
              placement="top"
            >
              <div
                onClick={onCheckDb}
                className={`cursor-pointer px-3 py-2 rounded-xl border text-[11px] flex items-center justify-between gap-2 transition-all ${
                  dbStatus.connected
                    ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300 hover:bg-emerald-950/50'
                    : dbStatus.usingCache
                    ? 'bg-amber-950/30 border-amber-800/50 text-amber-300 hover:bg-amber-950/50'
                    : 'bg-rose-950/30 border-rose-800/50 text-rose-300 hover:bg-rose-950/50'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <DatabaseOutlined
                    className={
                      dbStatus.connected
                        ? 'text-emerald-400'
                        : dbStatus.usingCache
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }
                  />
                  <span className="font-semibold truncate">MySQL:</span>
                  <span className="font-mono font-bold text-[10px]">
                    {dbStatus.loading ? (
                      <SyncOutlined spin />
                    ) : dbStatus.connected ? (
                      'ONLINE'
                    ) : dbStatus.usingCache ? (
                      'CACHE'
                    ) : (
                      'OFFLINE'
                    )}
                  </span>
                </div>
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    dbStatus.connected
                      ? 'bg-emerald-400 animate-pulse'
                      : dbStatus.usingCache
                      ? 'bg-amber-400'
                      : 'bg-rose-400'
                  }`}
                />
              </div>
            </Tooltip>
          ) : (
            <Tooltip
              title={
                dbStatus.connected
                  ? 'MySQL Online'
                  : dbStatus.usingCache
                  ? 'MySQL Cache (Sẵn sàng)'
                  : 'MySQL Offline'
              }
              placement="right"
            >
              <div
                onClick={onCheckDb}
                className="cursor-pointer w-full py-2 flex items-center justify-center rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/60"
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    dbStatus.connected
                      ? 'bg-emerald-400 animate-pulse'
                      : dbStatus.usingCache
                      ? 'bg-amber-400'
                      : 'bg-rose-400'
                  }`}
                />
              </div>
            </Tooltip>
          )}

          {/* Sider Collapse Trigger Button */}
          <Button
            type="text"
            onClick={onToggleCollapse}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            className="w-full text-slate-400 hover:text-slate-100 hover:bg-slate-900/80 rounded-xl h-8 flex items-center justify-center text-xs"
          >
            {!collapsed && <span className="ml-2 font-medium">Thu gọn thanh điều hướng</span>}
          </Button>
        </div>
      </div>
    </Sider>
  );
};

export default Sidebar;
