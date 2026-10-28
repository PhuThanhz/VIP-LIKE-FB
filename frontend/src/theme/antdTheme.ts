import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

export const DARK_THEME: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#06b6d4',
    colorBgBase: '#090d16',
    colorBgContainer: '#0f172a',
    colorBgElevated: '#1e293b',
    colorBorder: 'rgba(255, 255, 255, 0.08)',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.05)',
    colorText: '#f8fafc',
    colorTextSecondary: '#94a3b8',
    borderRadius: 12,
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  components: {
    Card: {
      colorBgContainer: 'rgba(13, 20, 36, 0.72)',
      colorBorderSecondary: 'rgba(255, 255, 255, 0.08)',
    },
    Modal: {
      contentBg: 'rgba(13, 20, 36, 0.92)',
      headerBg: 'transparent',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#2563eb',
      itemSelectedColor: '#ffffff',
      itemHoverBg: 'rgba(255, 255, 255, 0.06)',
      itemHoverColor: '#f8fafc',
      itemActiveBg: '#1d4ed8',
      itemMarginInline: 6,
      itemBorderRadius: 12,
      darkItemBg: 'transparent',
      darkItemSelectedBg: '#2563eb',
      darkItemSelectedColor: '#ffffff',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
    },
    Layout: {
      siderBg: 'transparent',
      bodyBg: 'transparent',
      headerBg: 'transparent',
    },
    Table: {
      headerBg: 'rgba(15, 23, 42, 0.75)',
      headerColor: '#94a3b8',
      headerSplitColor: 'transparent',
      headerSortActiveBg: 'rgba(15, 23, 42, 0.75)',
      headerSortHoverBg: 'rgba(30, 41, 59, 0.75)',
      bodySortBg: 'transparent',
      rowHoverBg: 'rgba(148, 163, 184, 0.06)',
      cellPaddingBlock: 14,
    },
    Input: {
      colorBgContainer: 'rgba(8, 13, 25, 0.75)',
      activeBorderColor: '#3b82f6',
    },
  },
};
