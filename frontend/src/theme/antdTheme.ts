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
      colorBgContainer: '#0f172a',
      colorBorderSecondary: 'rgba(255, 255, 255, 0.08)',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(6, 182, 212, 0.16)',
      itemSelectedColor: '#22d3ee',
      itemHoverBg: 'rgba(255, 255, 255, 0.06)',
      itemHoverColor: '#f8fafc',
      itemActiveBg: 'transparent',
      itemMarginInline: 6,
      itemBorderRadius: 12,
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(6, 182, 212, 0.16)',
      darkItemSelectedColor: '#22d3ee',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
    },
    Layout: {
      siderBg: '#090d16',
      bodyBg: '#050811',
      headerBg: '#090d16',
    },
    Table: {
      headerBg: '#090d16',
      rowHoverBg: 'rgba(6, 182, 212, 0.06)',
    },
    Input: {
      colorBgContainer: '#090d16',
      activeBorderColor: '#06b6d4',
    },
  },
};
