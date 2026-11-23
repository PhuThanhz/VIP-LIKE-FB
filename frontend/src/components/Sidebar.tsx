import React, { useMemo } from 'react';
import { Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';
import { NAV_ITEMS, NavKey, getRootNavItem } from '../config/navigation';
import AppVersion from './common/AppVersion';

const { Sider } = Layout;

export interface SidebarStats {
  queueCount?: number;
  historyCount?: number;
  monitorsCount?: number;
  accountsCount?: number;
  deadViasCount?: number;
}

interface SidebarProps {
  activeTabKey: string;
  onSelectTab: (key: string) => void;
  collapsed: boolean;
  /** Antd gọi khi cửa sổ vượt qua breakpoint `lg` (1024px) */
  onBreakpoint: (broken: boolean) => void;
  stats?: SidebarStats;
}

/** Số nhỏ bên phải mục menu (chỉ chữ xám, không khung màu) */
const Count: React.FC<{ value?: number }> = ({ value }) =>
  value ? <span className="ml-auto text-xs text-slate-500 tabular-nums">{value > 99 ? '99+' : value}</span> : null;

const renderBadge = (key: NavKey, stats: SidebarStats): React.ReactNode => {
  switch (key) {
    case 'buff-like':
      return <Count value={stats.queueCount} />;
    case 'buff-hunter':
      return <Count value={stats.monitorsCount} />;
    case 'via-management':
      if (stats.deadViasCount && stats.deadViasCount > 0) {
        return (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.5 rounded-full animate-pulse">
            ⚠️ {stats.deadViasCount} Via lỗi
          </span>
        );
      }
      return <Count value={stats.accountsCount} />;
    default:
      return null;
  }
};

const SidebarComponent: React.FC<SidebarProps> = ({
  activeTabKey,
  onSelectTab,
  collapsed,
  onBreakpoint,
  stats = {},
}) => {
  const { monitorsCount, queueCount, historyCount, accountsCount, deadViasCount } = stats;

  const menuItems = useMemo<MenuProps['items']>(() => {
    const badgeStats = { monitorsCount, queueCount, historyCount, accountsCount, deadViasCount };

    if (collapsed) {
      return NAV_ITEMS.filter((item) => !item.parent).map((item) => {
        const badge = renderBadge(item.key, badgeStats);
        return {
          key: item.key,
          title: item.label,
          icon: <item.Icon className="text-base" />,
          label: badge ? (
            <div className="flex items-center justify-between w-full">
              <span>{item.label}</span>
              {badge}
            </div>
          ) : (
            item.label
          ),
        };
      });
    }

    const groups: { [key: string]: { items: any[] } } = {
      engagement: { items: [] },
      channels: { items: [] },
      system: { items: [] },
    };

    NAV_ITEMS.filter((item) => !item.parent).forEach((item) => {
      const badge = renderBadge(item.key, badgeStats);
      const menuItem = {
        key: item.key,
        title: item.label,
        icon: <item.Icon className="text-base" />,
        label: badge ? (
          <div className="flex items-center justify-between w-full">
            <span>{item.label}</span>
            {badge}
          </div>
        ) : (
          item.label
        ),
      };

      if (['buff-like', 'buff-queue', 'buff-history'].includes(item.key)) {
        groups.engagement.items.push(menuItem);
      } else if (item.key === 'via-management') {
        groups.channels.items.push(menuItem);
      } else {
        groups.system.items.push(menuItem);
      }
    });

    const groupLabel = (text: string) => <span className="px-1">{text}</span>;
    return [
      { type: 'group', label: groupLabel('Chiến dịch'), children: groups.engagement.items },
      { type: 'group', label: groupLabel('Tài khoản'), children: groups.channels.items },
      { type: 'group', label: groupLabel('Hệ thống'), children: groups.system.items },
    ];
  }, [collapsed, monitorsCount, queueCount, historyCount, accountsCount]);

  const handleMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    // Bỏ focus trên item vừa click để highlight không bị dính lại
    (domEvent?.currentTarget as HTMLElement | undefined)?.blur?.();
    onSelectTab(key);
  };

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      breakpoint="lg"
      onBreakpoint={onBreakpoint}
      trigger={null}
      width={240}
      collapsedWidth={76}
      className="border-r flex flex-col justify-between select-none z-30 transition-all duration-300 !bg-slate-950/70 border-slate-800/60 backdrop-blur-xl"
      style={{ position: 'sticky', top: 0, height: '100vh', left: 0 }}
    >
      <div className="flex flex-col h-full">
        {/* Brand */}
        <div className={`h-16 flex items-center border-b shrink-0 border-slate-800/60 ${collapsed ? 'justify-center px-2' : 'px-4 gap-3'}`}>
          <img src="/logo.png" alt="VIP LIKE RADIANT" className="w-9 h-9 rounded-xl shadow-md border border-slate-800 shrink-0 object-cover" />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="text-[15px] font-bold text-slate-100 truncate tracking-tight flex items-center gap-1.5">
                <span>VIP LIKE</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                  RADIANT
                </span>
              </div>
              <div className="text-xs text-slate-400 truncate mt-0.5">Hệ thống tương tác Meta</div>
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <div className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[getRootNavItem(activeTabKey).key]}
            items={menuItems}
            onClick={handleMenuClick}
            className="!bg-transparent !border-0 text-sm px-2"
          />
        </div>

        {/* Số phiên bản + giờ build + trạng thái cập nhật */}
        <div className="p-2.5 border-t border-slate-800/60 shrink-0">
          <AppVersion compact={collapsed} />
        </div>
      </div>
    </Sider>
  );
};

export const Sidebar = React.memo(SidebarComponent);

export default Sidebar;
