import React from 'react';
import {
  ThunderboltOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  IdcardOutlined,
  PictureOutlined,
  SettingOutlined,
  KeyOutlined,
} from '@ant-design/icons';

export type NavKey =
  | 'buff-like'
  | 'buff-view'
  | 'post-hunter'
  | 'buff-queue'
  | 'buff-history'
  | 'via-management'
  | 'avatar-studio'
  | 'system-settings'
  | 'license-management';

export interface NavItem {
  key: NavKey;
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
    label: 'Like & Bình Luận',
    title: 'Like & Bình Luận',
    subtitle: 'Tăng tương tác bài viết Group, Fanpage, Profile cá nhân, Video Reels',
    iconColor: 'text-cyan-400',
    Icon: ThunderboltOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-view',
    label: 'Tăng View Video/Reels',
    title: 'Tăng View Video / Reels',
    subtitle: 'Buff lượt xem Video và Reels Facebook đa luồng Playwright không cần đăng nhập',
    iconColor: 'text-purple-400',
    Icon: PlayCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'post-hunter',
    label: 'Tự Săn Bài Mới',
    title: 'Tự Săn Bài Mới (Post Hunter)',
    subtitle: 'Theo dõi Fanpage & Nhóm mục tiêu, tự động nạp bài mới vào hàng đợi',
    iconColor: 'text-emerald-400',
    Icon: SearchOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-queue',
    label: 'Hàng Đợi Tự Động',
    title: 'Hàng Đợi Tự Động (Auto-Buff Queue)',
    subtitle: 'Xếp lịch chạy ngầm với độ trễ tự nhiên, xoay vòng dàn Page chống kiệt sức',
    iconColor: 'text-amber-400',
    Icon: ClockCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-history',
    label: 'Nhật Ký & Lịch Sử',
    title: 'Nhật Ký & Lịch Sử Tương Tác',
    subtitle: 'Sổ chống trùng lặp và thống kê chi tiết toàn bộ lượt tương tác',
    iconColor: 'text-blue-400',
    Icon: HistoryOutlined,
    group: 'engagement',
  },
  {
    key: 'via-management',
    label: 'Dàn Via & Cookie',
    title: 'Quản Lý Dàn Via & Fanpage Trực Thuộc',
    subtitle: 'Thêm tài khoản Facebook, quản lý Cookie/Proxy và cấu hình dàn Fanpage tương tác',
    iconColor: 'text-sky-400',
    Icon: IdcardOutlined,
    group: 'management',
  },
  {
    key: 'avatar-studio',
    label: 'Cập Nhật Avatar Page',
    title: 'Studio Cập Nhật Avatar & Ảnh Bìa Fanpage',
    subtitle: 'Đổi ảnh đại diện và ảnh bìa hàng loạt cho các Fanpage',
    iconColor: 'text-pink-400',
    Icon: PictureOutlined,
    group: 'management',
  },
  {
    key: 'system-settings',
    label: 'Cấu Hình & Telegram',
    title: 'Cấu Hình Vận Hành & Giám Sát Hệ Thống',
    subtitle: 'Bot Telegram báo cáo tức thời, cảnh báo checkpoint và chính sách vận hành',
    iconColor: 'text-slate-400',
    Icon: SettingOutlined,
    group: 'management',
  },
  {
    key: 'license-management',
    label: 'Cho Thuê & Bản Quyền',
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
