import React, { useState } from 'react';
import { Button, Tooltip, Breadcrumb, Avatar } from 'antd';
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
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import AuthModal, { CurrentUser } from './auth/AuthModal';
import { useThemeMode } from '../theme/ThemeContext';


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
}) => {
  const currentTab = TAB_TITLES[activeTabKey] || TAB_TITLES['buff-like'];
  const { isLight, toggleTheme } = useThemeMode();

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    try {
      const saved = localStorage.getItem('viplike_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);


  return (
    <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-xl sticky top-0 z-20 px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between gap-4">
        {/* Left: Collapse toggle + Active Page Title & Breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined className="text-slate-300 text-base" /> : <MenuFoldOutlined className="text-slate-300 text-base" />}
            onClick={onToggleCollapse}
            className="hover:bg-slate-900 rounded-xl w-9 h-9 flex items-center justify-center p-0 shrink-0"
          />

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="shrink-0">{currentTab.icon}</span>
              <h2 className="text-sm sm:text-base font-bold text-slate-100 tracking-wide m-0 truncate">
                {currentTab.title}
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block m-0 truncate">
              {currentTab.subtitle}
            </p>
          </div>
        </div>

        {/* Right Controls: Database status + Via manager + Settings */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
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
              className={`cursor-pointer px-3 py-1.5 rounded-xl border text-xs flex items-center gap-2 transition-all shadow-sm ${
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
                    ? 'text-emerald-400'
                    : dbStatus.usingCache
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }
              />
              <span className="font-semibold hidden md:inline">MySQL:</span>
              <span className="font-mono font-bold text-[11px]">
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
                    ? 'bg-emerald-400 animate-pulse'
                    : dbStatus.usingCache
                    ? 'bg-amber-400'
                    : 'bg-rose-400'
                }`}
              />
            </div>
          </Tooltip>

          {/* Via Management shortcut */}
          <Button
            icon={<IdcardOutlined className="text-cyan-400" />}
            onClick={onOpenViaManager}
            className="bg-slate-900 border-slate-700/80 hover:border-cyan-500/60 text-slate-200 text-xs font-semibold rounded-xl h-9"
          >
            <span className="hidden sm:inline">Quản lý Via & Cookie</span>
            <span className="sm:hidden">Via</span>
          </Button>

          {/* System Settings shortcut */}
          {onOpenSettings && (
            <Button
              icon={<SettingOutlined className="text-slate-300" />}
              onClick={onOpenSettings}
              className="bg-slate-900 border-slate-700/80 hover:border-slate-600 text-slate-300 text-xs rounded-xl h-9 px-3"
            >
              <span className="hidden lg:inline">Cài Đặt</span>
            </Button>
          )}

          {/* Light / Dark toggle */}
          <Tooltip title={isLight ? 'Chuyển sang giao diện Tối' : 'Chuyển sang giao diện Sáng'}>
            <Button
              aria-label="Chuyển giao diện Sáng/Tối"
              icon={isLight ? <MoonOutlined className="text-indigo-500" /> : <SunOutlined className="text-amber-300" />}
              onClick={toggleTheme}
              className="bg-slate-900 border-slate-700/80 hover:border-cyan-500/60 rounded-xl h-9 w-9 p-0 flex items-center justify-center"
            />
          </Tooltip>

          {/* Auth Login / User Profile Button */}
          {currentUser ? (
            <Button
              onClick={() => setIsAuthModalOpen(true)}
              className="bg-slate-900 border-cyan-800 hover:border-cyan-500 text-white text-xs rounded-xl h-9 px-2.5 flex items-center gap-2"
            >
              <Avatar size={22} icon={<UserOutlined />} className="bg-gradient-to-r from-cyan-500 to-blue-500" />
              <span className="font-semibold text-cyan-300 hidden md:inline">{currentUser.fullName}</span>
            </Button>
          ) : (
            <Button
              icon={<UserOutlined className="text-on-accent" />}
              onClick={() => setIsAuthModalOpen(true)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-on-accent text-xs font-semibold rounded-xl h-9 border-0 shadow-md shadow-cyan-500/20"
            >
              <span className="hidden sm:inline">Đăng Nhập</span>
              <span className="sm:hidden">Login</span>
            </Button>
          )}
        </div>
      </div>

      {/* Ant Design Modal Đăng Nhập / Đăng Ký / Kích Hoạt Key */}
      <AuthModal
        open={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUserChange={setCurrentUser}
      />
    </header>
  );
};


export default Header;
