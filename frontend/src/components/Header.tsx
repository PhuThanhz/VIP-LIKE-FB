import React, { useState } from 'react';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  SettingOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  UserOutlined,
  LogoutOutlined,
  KeyOutlined,
  PictureOutlined,
  UserAddOutlined,
  DownOutlined,
} from '@ant-design/icons';
import AuthModal, { AuthModalTab } from './auth/AuthModal';
import WallpaperModal from './common/WallpaperModal';
import { getRootNavItem } from '../config/navigation';
import { CurrentUser, isAdmin } from '../auth/session';

interface HeaderProps {
  activeTabKey: string;
  onOpenViaManager: () => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  currentUser: CurrentUser;
  onLogout: () => void;
}

const HeaderComponent: React.FC<HeaderProps> = ({
  activeTabKey,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  currentUser,
  onLogout,
}) => {
  const currentTab = getRootNavItem(activeTabKey);
  const admin = isAdmin(currentUser);
  const [accountModalTab, setAccountModalTab] = useState<AuthModalTab | null>(null);
  const [wallpaperModalOpen, setWallpaperModalOpen] = useState(false);

  const displayName = currentUser.fullName || currentUser.username;
  const initial = (displayName || '?').trim().charAt(0).toUpperCase();

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'user-info',
      label: (
        <div className="py-1 min-w-[200px]">
          <div className="text-sm font-semibold text-slate-100 truncate">{displayName}</div>
          <div className="text-xs text-slate-400 truncate">{currentUser.email || `@${currentUser.username}`}</div>
        </div>
      ),
      onClick: () => setAccountModalTab('profile'),
    },
    { type: 'divider' },
    { key: 'profile', icon: <UserOutlined />, label: 'Tài khoản', onClick: () => setAccountModalTab('profile') },
    { key: 'license', icon: <KeyOutlined />, label: 'Bản quyền', onClick: () => setAccountModalTab('license') },
    ...(admin
      ? [{ key: 'create-user', icon: <UserAddOutlined />, label: 'Tạo tài khoản', onClick: () => setAccountModalTab('create-user') }]
      : []),
    { type: 'divider' },
    { key: 'wallpaper', icon: <PictureOutlined />, label: 'Hình nền', onClick: () => setWallpaperModalOpen(true) },
    { key: 'settings', icon: <SettingOutlined />, label: 'Cài đặt', onClick: onOpenSettings },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', danger: true, onClick: onLogout },
  ];

  return (
    <header className="sticky top-0 z-20 h-16 px-4 sm:px-6 flex items-center border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 w-full">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="text"
            aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggleCollapse}
            className="w-9 h-9 shrink-0 text-slate-400 hover:text-slate-100"
          />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-100 m-0 leading-tight truncate">{currentTab.title}</h1>
            <p className="text-xs text-slate-400 m-0 mt-0.5 truncate hidden sm:block">{currentTab.subtitle}</p>
          </div>
        </div>

        <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
          <button
            type="button"
            className="flex items-center gap-2.5 h-10 pl-1 pr-2.5 rounded-full border border-slate-800 bg-slate-900/60 hover:border-slate-600 transition-colors cursor-pointer shrink-0"
          >
            <span className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-semibold flex items-center justify-center">
              {initial}
            </span>
            <span className="hidden md:flex flex-col items-start leading-tight">
              <span className="text-sm text-slate-100 max-w-[160px] truncate">{displayName}</span>
              <span className="text-[11px] text-slate-500">{admin ? 'Quản trị viên' : 'Thành viên'}</span>
            </span>
            <DownOutlined className="text-[10px] text-slate-500" />
          </button>
        </Dropdown>
      </div>

      <WallpaperModal open={wallpaperModalOpen} onClose={() => setWallpaperModalOpen(false)} />

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
