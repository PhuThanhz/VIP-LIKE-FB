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
  /** Mục con hiển thị dưới dạng tab bên trong trang cha (ẩn khỏi Sidebar) */
  parent?: NavKey;
  /** Nhãn ngắn trên Sidebar */
  label: string;
  /** Tiêu đề đầy đủ trên Header */
  title: string;
  subtitle: string;
  /** Lớp màu Tailwind cho icon, dùng chung giữa Sidebar và Header */
  iconColor: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Nhóm để Sidebar chèn đường kẻ phân cách */
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
    label: 'Tiến trình chạy',
    title: 'Tiến Trình Tương Tác Trực Tiếp',
    subtitle: 'Theo dõi trực tiếp quá trình bot thả Like / Comment theo thời gian thực',
    iconColor: 'text-blue-400',
    Icon: PlayCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-queue',
    parent: 'buff-like',
    label: 'Hàng Đợi Tự Động',
    title: 'Hàng Đợi Tự Động (Auto-Buff Queue)',
    subtitle: 'Xếp lịch chạy ngầm với độ trễ tự nhiên, xoay vòng dàn Page chống kiệt sức',
    iconColor: 'text-amber-400',
    Icon: ClockCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-history',
    parent: 'buff-like',
    label: 'Nhật Ký & Lịch Sử',
    title: 'Nhật Ký & Lịch Sử Tương Tác',
    subtitle: 'Sổ chống trùng lặp và thống kê chi tiết toàn bộ lượt tương tác',
    iconColor: 'text-blue-400',
    Icon: HistoryOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-hunter',
    label: 'Săn Bài & VIP Like',
    title: 'Săn Bài & VIP Like (Tự Động Theo Dõi Page/Group)',
    subtitle: 'Theo dõi 20 Fanpage/Group mục tiêu, tự động săn bài mới để buff và báo cáo tổng quan cuối ngày',
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
    subtitle: 'Telegram, thông báo và tự động',
    iconColor: 'text-slate-400',
    Icon: SettingOutlined,
    group: 'management',
  },
  {
    key: 'license-management',
    label: 'Bản quyền',
    title: 'Bản Quyền & Cho Thuê Phần Mềm',
    subtitle: 'Quản lý thời hạn bản quyền, kích hoạt mã máy và quản lý khách thuê tool',
    iconColor: 'text-amber-400',
    Icon: KeyOutlined,
    group: 'management',
  },
];

const NAV_BY_KEY = new Map<string, NavItem>(NAV_ITEMS.map((item) => [item.key, item]));

export const getNavItem = (key: string): NavItem =>
  NAV_BY_KEY.get(key) || NAV_BY_KEY.get(DEFAULT_NAV_KEY)!;

/** Mục hiển thị trên Sidebar/Header: tab con quy về trang cha */
export const getRootNavItem = (key: string): NavItem => {
  const item = getNavItem(key);
  return item.parent ? getNavItem(item.parent) : item;
};
