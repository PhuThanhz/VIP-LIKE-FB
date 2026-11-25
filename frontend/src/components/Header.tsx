import React, { useState, useEffect } from 'react';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  SettingOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  UserOutlined,
  LogoutOutlined,
  KeyOutlined,
  LockOutlined,
  PictureOutlined,
  UserAddOutlined,
  DownOutlined,
  WarningFilled,
  SafetyCertificateOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import AuthModal, { AuthModalTab } from './auth/AuthModal';
import WallpaperModal from './common/WallpaperModal';
import { SystemTelemetryModal } from './common/SystemTelemetryModal';
import { useCookieAlert } from './common/CookieAlertManager';
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
  const [telemetryModalOpen, setTelemetryModalOpen] = useState(false);

  // If user is logged in with default password, prompt them to change it on first entry
  useEffect(() => {
    if (currentUser?.isDefaultPassword) {
      setAccountModalTab('change-password');
    }
  }, [currentUser?.isDefaultPassword]);

  const { totalDeadCount, openModal } = useCookieAlert();
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
    { key: 'profile', icon: <UserOutlined />, label: 'Account', onClick: () => setAccountModalTab('profile') },
    { key: 'change-password', icon: <LockOutlined className="text-amber-400" />, label: 'Đổi mật khẩu', onClick: () => setAccountModalTab('change-password') },
    { key: 'license', icon: <KeyOutlined />, label: 'License', onClick: () => setAccountModalTab('license') },
    ...(admin
      ? [{ key: 'create-user', icon: <UserAddOutlined />, label: 'Create account', onClick: () => setAccountModalTab('create-user') }]
      : []),
    { type: 'divider' },
    { key: 'wallpaper', icon: <PictureOutlined />, label: 'Wallpaper', onClick: () => setWallpaperModalOpen(true) },
    { key: 'settings', icon: <SettingOutlined />, label: 'Settings', onClick: onOpenSettings },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Log out', danger: true, onClick: onLogout },
  ];

  return (
    <header className="sticky top-0 z-20 h-16 px-4 sm:px-6 flex items-center border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 w-full">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="text"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggleCollapse}
            className="w-9 h-9 shrink-0 text-slate-400 hover:text-slate-100"
          />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-100 m-0 leading-tight truncate">{currentTab.title}</h1>
            <p className="text-xs text-slate-400 m-0 mt-0.5 truncate hidden sm:block">{currentTab.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="small"
            icon={<DashboardOutlined className="text-cyan-400" />}
            onClick={() => setTelemetryModalOpen(true)}
            className="hidden sm:inline-flex items-center text-xs text-cyan-300 border-cyan-800/80 bg-cyan-950/40 hover:border-cyan-500 hover:text-cyan-100"
            title="View performance metrics, latency and Event Loop (BUFF LIKE 3.0)"
          >
            ⚡ Telemetry
          </Button>

          <Button
            size="small"
            icon={<SafetyCertificateOutlined className="text-cyan-400" />}
            onClick={() => openModal()}
            className="hidden sm:inline-flex items-center text-xs text-cyan-300 border-cyan-800/80 bg-cyan-950/40 hover:border-cyan-500 hover:text-cyan-100"
            title="Check whether cookies are still valid"
          >
            Check Cookies
          </Button>

          {totalDeadCount > 0 && (
            <button
              type="button"
              onClick={() => openModal()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/20 border border-rose-500/50 text-rose-300 hover:text-white hover:bg-rose-500/30 transition-all text-xs font-semibold cursor-pointer shadow-sm shadow-rose-950 animate-pulse"
              title="Some Vias have expired cookies or a checkpoint! Click to update"
            >
              <WarningFilled className="text-rose-400 text-sm" />
              <span>{totalDeadCount} Via cookie errors</span>
            </button>
          )}

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
                <span className="text-[11px] text-slate-500">{admin ? 'Administrator' : 'Member'}</span>
              </span>
              <DownOutlined className="text-[10px] text-slate-500" />
            </button>
          </Dropdown>
        </div>
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

      <SystemTelemetryModal
        open={telemetryModalOpen}
        onClose={() => setTelemetryModalOpen(false)}
      />
    </header>
  );
};

export const Header = React.memo(HeaderComponent);

export default Header;
