import React from 'react';
import {
  ThunderboltOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  IdcardOutlined,
  SettingOutlined,
  KeyOutlined,
  AimOutlined,
} from '@ant-design/icons';

export type NavKey =
  | 'buff-like'
  | 'buff-running'
  | 'buff-queue'
  | 'buff-history'
  | 'buff-hunter'
  | 'via-management'
  | 'system-settings'
  | 'license-management';

export interface NavItem {
  key: NavKey;
  /** Child item shown as a tab inside the parent page (hidden from the Sidebar) */
  parent?: NavKey;
  /** Short label on the Sidebar */
  label: string;
  /** Full title on the Header */
  title: string;
  subtitle: string;
  /** Tailwind color class for the icon, shared by Sidebar and Header */
  iconColor: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Group used by the Sidebar to insert a divider */
  group: 'engagement' | 'management';
}

export const DEFAULT_NAV_KEY: NavKey = 'buff-like';

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'buff-like',
    label: 'Like & Bình luận',
    title: 'Like & Bình luận',
    subtitle: 'Tạo chiến dịch, theo dõi hàng đợi và xem lịch sử',
    iconColor: 'text-cyan-400',
    Icon: ThunderboltOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-running',
    parent: 'buff-like',
    label: 'Tiến độ trực tiếp',
    title: 'Tiến độ tương tác trực tiếp',
    subtitle: 'Xem bot thả Like / Bình luận theo thời gian thực',
    iconColor: 'text-blue-400',
    Icon: PlayCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-queue',
    parent: 'buff-like',
    label: 'Hàng đợi tự động',
    title: 'Hàng đợi tự động (Auto-Buff)',
    subtitle: 'Lên lịch chạy nền với độ trễ tự nhiên, xoay vòng Page để tránh bị khóa',
    iconColor: 'text-amber-400',
    Icon: ClockCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-history',
    parent: 'buff-like',
    label: 'Nhật ký & Lịch sử',
    title: 'Nhật ký & Lịch sử tương tác',
    subtitle: 'Sổ chống trùng và thống kê chi tiết từng lượt tương tác',
    iconColor: 'text-blue-400',
    Icon: HistoryOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-hunter',
    // Opened from the tab bar on the "Likes & Comments" page, not repeated on the Sidebar
    parent: 'buff-like',
    label: 'Săn bài & VIP Like',
    title: 'Săn bài & VIP Like (Tự theo dõi Page/Group)',
    subtitle: 'Theo dõi 20 Fanpage/Group mục tiêu, tự săn bài mới để buff và gửi báo cáo cuối ngày',
    iconColor: 'text-emerald-400',
    Icon: AimOutlined,
    group: 'engagement',
  },
  {
    key: 'via-management',
    label: 'Via & Fanpage',
    title: 'Via & Fanpage',
    subtitle: 'Quản lý tài khoản, Cookie, Proxy và Fanpage',
    iconColor: 'text-sky-400',
    Icon: IdcardOutlined,
    group: 'management',
  },
  {
    key: 'system-settings',
    label: 'Cài đặt',
    title: 'Cài đặt',
    subtitle: 'Telegram, thông báo và tự động hóa',
    iconColor: 'text-slate-400',
    Icon: SettingOutlined,
    group: 'management',
  },
  {
    key: 'license-management',
    label: 'Bản quyền',
    title: 'Bản quyền & Cho thuê phần mềm',
    subtitle: 'Quản lý thời hạn bản quyền, kích hoạt mã máy và người thuê tool',
    iconColor: 'text-amber-400',
    Icon: KeyOutlined,
    group: 'management',
  },
];

const NAV_BY_KEY = new Map<string, NavItem>(NAV_ITEMS.map((item) => [item.key, item]));

export const getNavItem = (key: string): NavItem =>
  NAV_BY_KEY.get(key) || NAV_BY_KEY.get(DEFAULT_NAV_KEY)!;

/** Item shown on the Sidebar/Header: child tabs resolve to their parent page */
export const getRootNavItem = (key: string): NavItem => {
  const item = getNavItem(key);
  return item.parent ? getNavItem(item.parent) : item;
};
