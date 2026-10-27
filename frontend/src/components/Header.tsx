import React, { useState } from 'react';
import { Button, Tooltip, Avatar, Dropdown, Tag } from 'antd';
import type { MenuProps } from 'antd';
import {
  IdcardOutlined,
  SettingOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  UserOutlined,
  LogoutOutlined,
  KeyOutlined,
  DatabaseOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import AuthModal, { AuthModalTab } from './auth/AuthModal';
import { getNavItem } from '../config/navigation';
import { CurrentUser, isAdmin } from '../auth/session';
import type { DbStatus } from '../types/dbStatus';

interface HeaderProps {
  activeTabKey: string;
  onOpenViaManager: () => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  dbStatus: DbStatus;
  onCheckDb: () => void;
  currentUser: CurrentUser;
  onLogout: () => void;
}

/** Trạng thái MySQL: xanh = kết nối, vàng = đang dùng cache, đỏ = mất kết nối. Bấm để kiểm tra lại. */
const DbStatusButton: React.FC<{ status: DbStatus; onCheck: () => void }> = ({ status, onCheck }) => {
  const view = status.connected
    ? { dot: 'bg-emerald-400', label: 'MySQL', tip: `Đã kết nối MySQL (${status.database || 'autopost_saas'})` }
    : status.usingCache
      ? { dot: 'bg-amber-400', label: 'Cache', tip: `Mất kết nối MySQL, đang dùng dữ liệu cache (${status.cachedCount || 0} tài khoản)` }
      : { dot: 'bg-rose-500', label: 'Mất kết nối', tip: `Không kết nối được MySQL: ${status.error || 'không rõ lỗi'}` };

  return (
    <Tooltip title={`${view.tip}. Bấm để kiểm tra lại.`}>
      <Button
        onClick={onCheck}
        aria-label={view.tip}
        className="text-xs rounded-xl h-9 px-2.5 border bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500 flex items-center gap-2"
      >
        {status.loading ? (
          <SyncOutlined spin className="text-slate-400" />
        ) : (
          <span className={`w-2 h-2 rounded-full ${view.dot}`} />
        )}
        <DatabaseOutlined className="text-slate-400" />
        <span className="hidden xl:inline">{view.label}</span>
      </Button>
    </Tooltip>
  );
};

const HeaderComponent: React.FC<HeaderProps> = ({
  activeTabKey,
  onOpenViaManager,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  dbStatus,
  onCheckDb,
  currentUser,
  onLogout,
}) => {
  const currentTab = getNavItem(activeTabKey);
  const admin = isAdmin(currentUser);
  const [accountModalTab, setAccountModalTab] = useState<AuthModalTab | null>(null);

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'user-info',
      label: (
        <div className="py-1 px-1">
          <div className="font-bold text-xs">{currentUser.fullName}</div>
          <div className="text-[11px] text-slate-400">
            @{currentUser.username} • {currentUser.email}
          </div>
          <Tag color="cyan" className="mt-1 text-[10px] rounded-md px-1 py-0 border-0">
            {admin ? '👑 QUẢN TRỊ VIÊN' : 'VIP PRO'}
          </Tag>
        </div>
      ),
      onClick: () => setAccountModalTab('profile'),
    },
    { type: 'divider' },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Cài Đặt Hệ Thống',
      onClick: onOpenSettings,
    },
    {
      key: 'license',
      icon: <KeyOutlined />,
      label: 'Kích Hoạt Bản Quyền & HWID',
      onClick: () => setAccountModalTab('license'),
    },
    ...(admin
      ? [
          {
            key: 'create-user',
            icon: <UserOutlined />,
            label: 'Tạo Tài Khoản Mới',
            onClick: () => setAccountModalTab('create-user'),
          },
        ]
      : []),
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined className="text-rose-500" />,
      label: <span className="text-rose-500 font-semibold">Đăng Xuất Khỏi Hệ Thống</span>,
      onClick: onLogout,
    },
  ];

  return (
    <header className="border-b sticky top-0 z-20 px-4 sm:px-6 py-3 bg-slate-900/90 border-slate-800/80 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4">
        {/* Left: Collapse toggle + tiêu đề trang hiện tại */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button
            type="text"
            aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            icon={
              collapsed ? (
                <MenuUnfoldOutlined className="text-slate-300 text-base" />
              ) : (
                <MenuFoldOutlined className="text-slate-300 text-base" />
              )
            }
            onClick={onToggleCollapse}
            className="rounded-xl w-9 h-9 flex items-center justify-center p-0 shrink-0 hover:bg-slate-800"
          />

          <div className="min-w-[120px] flex-1">
            <div className="flex items-center gap-2" title={currentTab.title}>
              <currentTab.Icon className={`shrink-0 text-base ${currentTab.iconColor}`} />
              <h2 className="text-sm sm:text-base font-bold tracking-wide m-0 leading-snug line-clamp-2 text-slate-100">
                {currentTab.title}
              </h2>
            </div>
            <p className="text-[11px] hidden sm:block m-0 truncate text-slate-400">{currentTab.subtitle}</p>
          </div>
        </div>

        {/* Right: lối tắt + tài khoản */}
        <div className="flex items-center gap-2 xl:gap-3 shrink-0">
          <DbStatusButton status={dbStatus} onCheck={onCheckDb} />

          <Tooltip title="Quản lý Via & Cookie">
            <Button
              icon={<IdcardOutlined className="text-cyan-500" />}
              onClick={onOpenViaManager}
              aria-label="Quản lý Via & Cookie"
              className="text-xs font-semibold rounded-xl h-9 px-2.5 2xl:px-3 border bg-slate-800 border-slate-700 text-slate-200 hover:border-cyan-500"
            >
              <span className="hidden 2xl:inline">Quản lý Via & Cookie</span>
            </Button>
          </Tooltip>

          <Tooltip title="Cài Đặt">
            <Button
              icon={<SettingOutlined className="text-slate-300" />}
              onClick={onOpenSettings}
              aria-label="Cài Đặt"
              className="text-xs rounded-xl h-9 px-2.5 2xl:px-3 border bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
            >
              <span className="hidden 2xl:inline">Cài Đặt</span>
            </Button>
          </Tooltip>

          <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
            <Button className="border text-xs rounded-xl h-9 px-2.5 flex items-center gap-2 cursor-pointer shadow-sm bg-slate-800 border-slate-700 text-white hover:border-cyan-500">
              <Avatar
                size={24}
                icon={<UserOutlined />}
                className="bg-gradient-to-r from-cyan-500 to-blue-500 font-bold"
              />
              <span className="font-semibold text-xs hidden xl:inline max-w-[140px] truncate">
                {currentUser.fullName}
              </span>
              <Tag color="cyan" className="hidden 2xl:inline text-[10px] rounded-full px-1.5 py-0 border-0 m-0">
                {admin ? 'Admin' : 'VIP'}
              </Tag>
            </Button>
          </Dropdown>
        </div>
      </div>

      {accountModalTab && (
        <AuthModal
          open
          initialTab={accountModalTab}
          onClose={() => setAccountModalTab(null)}
          currentUser={currentUser}
          onLogout={onLogout}
        />
      )}
    </header>
  );
};

export const Header = React.memo(HeaderComponent);

export default Header;
