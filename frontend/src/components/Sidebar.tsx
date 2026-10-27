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
      className="border-r flex flex-col justify-between select-none z-30 transition-all duration-300 !bg-slate-900 border-slate-800/80"
      style={{
        position: 'sticky',
        top: 0,
        height: '100vh',
        left: 0,
      }}
    >
      <div className="flex flex-col h-full">
        {/* Brand Header */}
        <div className="h-16 flex items-center px-4 border-b shrink-0 border-slate-800/80 bg-slate-900">
          <div className="flex items-center gap-3 w-full overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-500 p-0.5 shadow-md shadow-cyan-500/20 shrink-0 flex items-center justify-center">
              <div className="w-full h-full rounded-[10px] flex items-center justify-center bg-slate-950/90">
                <ThunderboltFilled className="text-lg text-cyan-500 animate-pulse" />
              </div>
            </div>

            {!collapsed && (
              <div className="flex flex-col min-w-0 transition-opacity duration-200">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black tracking-wider bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent truncate uppercase">
                    VIPLIKE RADIANT
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold shrink-0 border bg-cyan-950/90 text-cyan-300 border-cyan-800/60">
                    v2.0
                  </span>
                </div>
                <span className="text-[10px] truncate text-slate-400">
                  Buff Like & Săn Bài Meta
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Ant Design Navigation Menu */}
        <div className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[activeTabKey]}
            items={menuItems}
            onClick={handleMenuClick}
            className="!bg-transparent !border-0 text-xs font-semibold px-2 space-y-1"
          />
        </div>

        {/* Bottom Sider Collapse Toggle */}
        <div className="p-3 border-t shrink-0 border-slate-800/80 bg-slate-950/40">

          {/* Sider Collapse Trigger Button */}
          <Button
            type="text"
            onClick={onToggleCollapse}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            className="w-full rounded-xl h-8 flex items-center justify-center text-xs transition-colors text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            {!collapsed && <span className="ml-2 font-medium">Thu gọn thanh điều hướng</span>}
          </Button>
        </div>
      </div>
    </Sider>
  );
};

export default Sidebar;
