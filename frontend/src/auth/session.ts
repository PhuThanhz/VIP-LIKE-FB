import { createContext, useContext } from 'react';

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
}

export const TOKEN_KEY = 'viplike_token';
export const USER_KEY = 'viplike_user';
export const HWID_KEY = 'viplike_hwid';
export const AUTH_EXPIRED_EVENT = 'viplike_auth_expired';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const getStoredUser = (): CurrentUser | null => {
  try {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

export const saveSession = (token: string, user: CurrentUser) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const saveUser = (user: CurrentUser) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

/**
 * Chuẩn hoá phản hồi /auth/login của backend.
 * Backend trả cả `{ token, user }` lẫn `{ data: { token, ...user } }` nên đọc cả hai dạng.
 */
export const parseAuthResponse = (body: any): { token: string; user: CurrentUser } | null => {
  const data = body?.data || body;
  const token = body?.token || data?.token;
  if (!token) return null;

  const raw = body?.user || data?.user || data;
  if (!raw?.username) return null;

  return {
    token,
    user: {
      id: raw.id,
      username: raw.username,
      email: raw.email || '',
      fullName: raw.fullName || raw.username,
      role: raw.role || 'USER',
    },
  };
};

export const isAdmin = (user: CurrentUser | null | undefined): boolean => user?.role === 'ADMIN';

export const CurrentUserContext = createContext<CurrentUser | null>(null);

export const useCurrentUser = (): CurrentUser | null => useContext(CurrentUserContext);
