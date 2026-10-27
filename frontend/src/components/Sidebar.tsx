import React, { useMemo } from 'react';
import { Layout, Menu, Badge, Tag, Button } from 'antd';
import type { MenuProps } from 'antd';
import { ThunderboltFilled, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { NAV_ITEMS, NavKey } from '../config/navigation';

const { Sider } = Layout;

export interface SidebarStats {
  queueCount?: number;
  historyCount?: number;
  monitorsCount?: number;
  accountsCount?: number;
}

interface SidebarProps {
  activeTabKey: string;
  onSelectTab: (key: string) => void;
  collapsed: boolean;
  /** Antd gọi khi cửa sổ vượt qua breakpoint `lg` (1024px) */
  onCollapsedChange: (collapsed: boolean) => void;
  onToggleCollapse: () => void;
  stats?: SidebarStats;
}

const TAG_CLASS = 'ml-auto text-[10px] font-mono rounded-full px-1.5 py-0 border-0 leading-tight';

const renderBadge = (key: NavKey, stats: SidebarStats): React.ReactNode => {
  switch (key) {
    case 'post-hunter':
      return stats.monitorsCount ? <Tag color="cyan" className={TAG_CLASS}>{stats.monitorsCount}</Tag> : null;
    case 'buff-queue':
      return stats.queueCount ? (
        <Badge count={stats.queueCount} overflowCount={99} size="small" className="ml-auto" />
      ) : null;
    case 'buff-history':
      return stats.historyCount ? (
        <span className="text-[10px] text-slate-500 font-mono ml-auto">{stats.historyCount}</span>
      ) : null;
    case 'via-management':
      return stats.accountsCount ? <Tag color="blue" className={TAG_CLASS}>{stats.accountsCount} nick</Tag> : null;
    case 'avatar-studio':
      return <Tag color="magenta" className={TAG_CLASS}>MỚI</Tag>;
    case 'license-management':
      return <Tag color="gold" className={TAG_CLASS}>SaaS</Tag>;
    default:
      return null;
  }
};

const SidebarComponent: React.FC<SidebarProps> = ({
  activeTabKey,
  onSelectTab,
  collapsed,
  onCollapsedChange,
  onToggleCollapse,
  stats = {},
}) => {
  const { monitorsCount, queueCount, historyCount, accountsCount } = stats;

  const menuItems = useMemo<MenuProps['items']>(() => {
    const badgeStats = { monitorsCount, queueCount, historyCount, accountsCount };
    const items: MenuProps['items'] = [];
    NAV_ITEMS.forEach((item, index) => {
      if (index > 0 && NAV_ITEMS[index - 1].group !== item.group) {
        items.push({ type: 'divider', className: 'my-2 border-slate-800/80' });
      }
      const badge = renderBadge(item.key, badgeStats);
      items.push({
        key: item.key,
        icon: <item.Icon className={`text-base ${item.iconColor}`} />,
        label: badge ? (
          <div className="flex items-center justify-between w-full">
            <span>{item.label}</span>
            {badge}
          </div>
        ) : (
          item.label
        ),
      });
    });
    return items;
  }, [monitorsCount, queueCount, historyCount, accountsCount]);

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
      onBreakpoint={onCollapsedChange}
      trigger={null}
      width={260}
      collapsedWidth={76}
      className="border-r flex flex-col justify-between select-none z-30 transition-all duration-300 !bg-slate-900 border-slate-800/80"
      style={{ position: 'sticky', top: 0, height: '100vh', left: 0 }}
    >
      <div className="flex flex-col h-full">
        {/* Brand Header */}
        <div className="h-16 flex items-center px-4 border-b shrink-0 border-slate-800/80 bg-slate-900">
          <div className="flex items-center gap-3 w-full overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-500 p-0.5 shadow-md shadow-cyan-500/20 shrink-0 flex items-center justify-center">
              <div className="w-full h-full rounded-[10px] flex items-center justify-center bg-slate-950/90">
                <ThunderboltFilled className="text-lg text-cyan-500" />
              </div>
            </div>

            {!collapsed && (
              <div className="flex flex-col min-w-0 transition-opacity duration-200">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black tracking-wider bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent truncate uppercase">
                    VIPLIKE RADIANT
                  </span>
                  <span className="px-1.5 rounded text-[9px] font-mono font-bold shrink-0 border bg-cyan-950/90 text-cyan-300 border-cyan-800/60">
                    v2.0
                  </span>
                </div>
                <span className="text-[10px] truncate text-slate-400">Buff Like & Săn Bài Meta</span>
              </div>
            )}
          </div>
        </div>

        {/* Navigation Menu */}
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

        {/* Collapse Toggle */}
        <div className="p-3 border-t shrink-0 border-slate-800/80 bg-slate-950/40">
          <Button
            type="text"
            onClick={onToggleCollapse}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            className="w-full rounded-xl h-8 flex items-center justify-center text-xs transition-colors text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            {!collapsed && <span className="ml-2 font-medium">Thu gọn thanh điều hướng</span>}
          </Button>
        </div>
      </div>
    </Sider>
  );
};

export const Sidebar = React.memo(SidebarComponent);

export default Sidebar;
