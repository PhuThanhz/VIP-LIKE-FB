import React, { createContext, useContext, useEffect, useMemo } from 'react';

export type ThemeMode = 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  isLight: boolean;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light');
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
    try {
      localStorage.setItem('viplike-theme', 'dark');
    } catch {}
  }, []);

  const value = useMemo(
    () => ({
      mode: 'dark' as ThemeMode,
      isLight: false,
      toggleTheme: () => {},
      setMode: () => {},
    }),
    []
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useThemeMode = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: 'dark',
      isLight: false,
      toggleTheme: () => {},
      setMode: () => {},
    };
  }
  return ctx;
};

export default ThemeProvider;
