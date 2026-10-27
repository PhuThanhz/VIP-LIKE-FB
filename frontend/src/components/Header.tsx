import React, { useState } from 'react';
import { Button, Tooltip, Breadcrumb, Avatar, Dropdown, Tag } from 'antd';
import {
  DatabaseOutlined,
  SyncOutlined,
  IdcardOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import AuthModal, { CurrentUser } from './auth/AuthModal';


export interface HeaderDbStatus {
  connected: boolean;
  usingCache?: boolean;
  cachedCount?: number;
  database?: string;
  loading: boolean;
  error?: string;
}

interface HeaderProps {
  activeTabKey: string;
  onOpenViaManager: () => void;
  onOpenSettings?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  dbStatus: HeaderDbStatus;
  onCheckDb: () => void;
  currentUser?: CurrentUser | null;
  onLogout?: () => void;
  onUserChange?: (user: CurrentUser | null) => void;
}

const TAB_TITLES: Record<string, { title: string; subtitle: string; icon: React.ReactNode }> = {
  'buff-like': {
    title: 'Like & Bình Luận',
    subtitle: 'Tăng tương tác bài viết Group, Fanpage, Profile cá nhân, Video Reels',
    icon: <ThunderboltOutlined className="text-cyan-400 text-base" />,
  },
  'buff-view': {
    title: 'Tăng View Video / Reels',
    subtitle: 'Buff lượt xem Video và Reels Facebook đa luồng Playwright không cần đăng nhập',
    icon: <PlayCircleOutlined className="text-purple-400 text-base" />,
  },
  'post-hunter': {
    title: 'Tự Săn Bài Mới (Post Hunter)',
    subtitle: 'Theo dõi Fanpage & Nhóm mục tiêu, tự động nạp bài mới vào hàng đợi',
    icon: <SearchOutlined className="text-emerald-400 text-base" />,
  },
  'buff-queue': {
    title: 'Hàng Đợi Tự Động (Auto-Buff Queue)',
    subtitle: 'Xếp lịch chạy ngầm với độ trễ tự nhiên, xoay vòng dàn Page chống kiệt sức',
    icon: <ClockCircleOutlined className="text-amber-400 text-base" />,
  },
  'buff-history': {
    title: 'Nhật Ký & Lịch Sử Tương Tác',
    subtitle: 'Sổ chống trùng lặp và thống kê chi tiết toàn bộ lượt tương tác',
    icon: <HistoryOutlined className="text-blue-400 text-base" />,
  },
  'via-management': {
    title: 'Quản Lý Dàn Via & Fanpage Trực Thuộc',
    subtitle: 'Thêm tài khoản Facebook, quản lý Cookie/Proxy và cấu hình dàn Fanpage tương tác',
    icon: <IdcardOutlined className="text-sky-400 text-base" />,
  },
  'system-settings': {
    title: 'Cấu Hình Vận Hành & Giám Sát Hệ Thống',
    subtitle: 'Bot Telegram báo cáo tức thời, cảnh báo checkpoint và chính sách an toàn dàn nick',
    icon: <SettingOutlined className="text-blue-400 text-base" />,
  },
  'license-management': {
    title: 'Hệ Thống Cho Thuê & Bản Quyền Phần Mềm (SaaS)',
    subtitle: 'Quản lý thời hạn thuê, mã máy HWID, cấp key bản quyền và khóa/mở từ xa',
    icon: <IdcardOutlined className="text-amber-400 text-base" />,
  },
};


export const Header: React.FC<HeaderProps> = ({
  activeTabKey,
  onOpenViaManager,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  dbStatus,
  onCheckDb,
  currentUser: propUser,
  onLogout,
  onUserChange,
}) => {
  const currentTab = TAB_TITLES[activeTabKey] || TAB_TITLES['buff-like'];

  const [localUser, setLocalUser] = useState<CurrentUser | null>(() => {
    try {
      const saved = localStorage.getItem('viplike_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const currentUser = propUser !== undefined ? propUser : localUser;
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      localStorage.removeItem('viplike_token');
      localStorage.removeItem('viplike_user');
      setLocalUser(null);
      if (onUserChange) onUserChange(null);
    }
  };

  return (
    <header className="border-b sticky top-0 z-20 px-4 sm:px-6 py-3 bg-slate-900/90 border-slate-800/80 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4">
        {/* Left: Collapse toggle + Active Page Title & Breadcrumb */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined className="text-slate-300 text-base" /> : <MenuFoldOutlined className="text-slate-300 text-base" />}
            onClick={onToggleCollapse}
            className="rounded-xl w-9 h-9 flex items-center justify-center p-0 shrink-0 hover:bg-slate-800"
          />

          <div className="min-w-[120px] flex-1">
            <div className="flex items-center gap-2" title={currentTab.title}>
              <span className="shrink-0">{currentTab.icon}</span>
              <h2 className="text-sm sm:text-base font-bold tracking-wide m-0 leading-snug line-clamp-2 text-slate-100">
                {currentTab.title}
              </h2>
            </div>
            <p className="text-[11px] hidden sm:block m-0 truncate text-slate-400">
              {currentTab.subtitle}
            </p>
          </div>
        </div>

        {/* Right Controls: Database status + Via manager + Settings + Auth */}
        <div className="flex items-center gap-2 xl:gap-3 shrink-0">
          {/* MySQL Status Pill */}
          <Tooltip
            title={
              dbStatus.connected
                ? `Đã kết nối MySQL Workbench thành công (DB: ${dbStatus.database || 'autopost_saas'})`
                : dbStatus.usingCache
                ? `MySQL chưa bật - Đang hoạt động ở chế độ Bộ Nhớ Đệm (${dbStatus.cachedCount || 0} Via sẵn sàng). Nhấp để thử kết nối lại MySQL.`
                : `Lỗi kết nối MySQL: ${dbStatus.error || 'Kiểm tra port 3306'}`
            }
          >
            <div
              onClick={onCheckDb}
              className={`cursor-pointer px-2.5 2xl:px-3 h-9 rounded-xl border text-xs flex items-center gap-2 transition-all shadow-sm ${
                dbStatus.connected
                  ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-300 hover:bg-emerald-950/50'
                  : dbStatus.usingCache
                  ? 'bg-amber-950/30 border-amber-700/50 text-amber-300 hover:bg-amber-950/50'
                  : 'bg-rose-950/30 border-rose-700/50 text-rose-300 hover:bg-rose-950/50'
              }`}
            >
              <DatabaseOutlined
                className={
                  dbStatus.connected
                    ? 'text-emerald-500'
                    : dbStatus.usingCache
                    ? 'text-amber-500'
                    : 'text-rose-500'
                }
              />
              <span className="font-semibold hidden 2xl:inline">MySQL:</span>
              <span className="font-mono font-bold text-[11px] hidden lg:inline">
                {dbStatus.loading ? (
                  <SyncOutlined spin className="text-slate-400" />
                ) : dbStatus.connected ? (
                  'ONLINE'
                ) : dbStatus.usingCache ? (
                  'CACHE (SẴN SÀNG)'
                ) : (
                  'OFFLINE'
                )}
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  dbStatus.connected
                    ? 'bg-emerald-500 animate-pulse'
                    : dbStatus.usingCache
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
              />
            </div>
          </Tooltip>

          {/* Via Management shortcut */}
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

          {/* System Settings shortcut */}
          {onOpenSettings && (
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
          )}

          {/* User Profile Dropdown when logged in, or Login button if not */}
          {currentUser ? (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'user-info',
                    label: (
                      <div className="py-1 px-1">
                        <div className="font-bold text-xs">{currentUser.fullName}</div>
                        <div className="text-[11px] text-slate-400">@{currentUser.username} • {currentUser.email}</div>
                        <Tag color="cyan" className="mt-1 text-[10px] rounded-md px-1 py-0 border-0">
                          {currentUser.role === 'ADMIN' ? '👑 QUẢN TRỊ VIÊN' : 'VIP PRO'}
                        </Tag>
                      </div>
                    ),
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
                    icon: <IdcardOutlined />,
                    label: 'Quản Lý Bản Quyền & HWID',
                    onClick: () => setIsAuthModalOpen(true),
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined className="text-rose-500" />,
                    label: <span className="text-rose-500 font-semibold">Đăng Xuất Khỏi Hệ Thống</span>,
                    onClick: handleLogout,
                  },
                ],
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button
                className="border text-xs rounded-xl h-9 px-2.5 flex items-center gap-2 cursor-pointer shadow-sm bg-slate-800 border-slate-700 text-white hover:border-cyan-500"
              >
                <Avatar
                  size={24}
                  icon={<UserOutlined />}
                  className="bg-gradient-to-r from-cyan-500 to-blue-500 font-bold"
                />
                <span className="font-semibold text-xs hidden xl:inline max-w-[140px] truncate">
                  {currentUser.fullName}
                </span>
                <Tag color="cyan" className="hidden 2xl:inline text-[10px] rounded-full px-1.5 py-0 border-0 m-0">
                  {currentUser.role === 'ADMIN' ? 'Admin' : 'VIP'}
                </Tag>
              </Button>
            </Dropdown>
          ) : (
            <Button
              icon={<UserOutlined className="text-white" />}
              onClick={() => setIsAuthModalOpen(true)}
              aria-label="Đăng Nhập"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl h-9 px-2.5 lg:px-3 border-0 shadow-md shadow-cyan-500/20"
            >
              <span className="hidden lg:inline">Đăng Nhập</span>
            </Button>
          )}
        </div>
      </div>

      {/* Ant Design Modal Đăng Nhập / Đăng Ký / Kích Hoạt Key */}
      <AuthModal
        open={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUserChange={(user) => {
          setLocalUser(user);
          if (onUserChange) onUserChange(user);
        }}
      />
    </header>
  );
};

export default Header;
