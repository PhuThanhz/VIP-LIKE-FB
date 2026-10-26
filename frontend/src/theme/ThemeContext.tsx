import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'viplike-theme';

interface ThemeContextValue {
  mode: ThemeMode;
  isLight: boolean;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// index.html đã gán class lên <html> trước khi React chạy, đọc lại từ đó để khớp
const readInitialMode = (): ThemeMode => {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('light')) {
    return 'light';
  }
  return 'dark';
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>(readInitialMode);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', mode === 'light');
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage có thể bị chặn, bỏ qua
    }
  }, [mode]);

  const toggleTheme = useCallback(() => setMode((prev) => (prev === 'light' ? 'dark' : 'light')), []);

  const value = useMemo(
    () => ({ mode, isLight: mode === 'light', toggleTheme, setMode }),
    [mode, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useThemeMode = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode phải nằm trong ThemeProvider');
  return ctx;
};
