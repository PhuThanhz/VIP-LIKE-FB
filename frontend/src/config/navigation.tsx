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
    label: 'Likes & Comments',
    title: 'Likes & Comments',
    subtitle: 'Create campaigns, track the queue and view history',
    iconColor: 'text-cyan-400',
    Icon: ThunderboltOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-running',
    parent: 'buff-like',
    label: 'Live progress',
    title: 'Live Engagement Progress',
    subtitle: 'Watch the bot drop Likes / Comments in real time',
    iconColor: 'text-blue-400',
    Icon: PlayCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-queue',
    parent: 'buff-like',
    label: 'Auto Queue',
    title: 'Auto Queue (Auto-Buff Queue)',
    subtitle: 'Schedule background runs with natural delays, rotating Pages to avoid burnout',
    iconColor: 'text-amber-400',
    Icon: ClockCircleOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-history',
    parent: 'buff-like',
    label: 'Logs & History',
    title: 'Engagement Logs & History',
    subtitle: 'Dedupe registry and detailed stats for every engagement',
    iconColor: 'text-blue-400',
    Icon: HistoryOutlined,
    group: 'engagement',
  },
  {
    key: 'buff-hunter',
    // Opened from the tab bar on the "Likes & Comments" page, not repeated on the Sidebar
    parent: 'buff-like',
    label: 'Post Hunter & VIP Like',
    title: 'Post Hunter & VIP Like (Auto-Monitor Pages/Groups)',
    subtitle: 'Monitor 20 target Fanpages/Groups, auto-hunt new posts to buff and send an end-of-day summary',
    iconColor: 'text-emerald-400',
    Icon: AimOutlined,
    group: 'engagement',
  },
  {
    key: 'via-management',
    label: 'Via & Fanpage',
    title: 'Via & Fanpage',
    subtitle: 'Manage accounts, Cookies, Proxies and Fanpages',
    iconColor: 'text-sky-400',
    Icon: IdcardOutlined,
    group: 'management',
  },
  {
    key: 'system-settings',
    label: 'Settings',
    title: 'Settings',
    subtitle: 'Telegram, notifications and automation',
    iconColor: 'text-slate-400',
    Icon: SettingOutlined,
    group: 'management',
  },
  {
    key: 'license-management',
    label: 'License',
    title: 'Licensing & Software Rental',
    subtitle: 'Manage license terms, activate machine IDs and manage tool renters',
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
