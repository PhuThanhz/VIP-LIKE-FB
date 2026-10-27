import axios, { type InternalAxiosRequestConfig } from 'axios';
import { AUTH_EXPIRED_EVENT, HWID_KEY, clearSession, getToken } from '../auth/session';

export const getSafeHost = (): string => {
  if (typeof window === 'undefined') return '127.0.0.1';
  const h = window.location.hostname;
  if (!h || h.includes('tauri') || h === 'localhost' || h === '127.0.0.1') {
    return '127.0.0.1';
  }
  return h;
};

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  `http://${getSafeHost()}:3100/api`;

export const WORKER_BASE_URL =
  import.meta.env.VITE_WORKER_BASE_URL ||
  `http://${getSafeHost()}:3100`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 180000, // 3 phút cho các tác vụ Playwright
});

// Gắn Token JWT và mã máy HWID vào mọi request
const attachAuthHeaders = (config: InternalAxiosRequestConfig) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const hwid = localStorage.getItem(HWID_KEY);
  if (hwid) {
    config.headers['X-Hardware-HWID'] = hwid;
  }
  return config;
};

api.interceptors.request.use(attachAuthHeaders);
// Gắn cả cho axios mặc định (một số component gọi axios trực tiếp)
axios.interceptors.request.use(attachAuthHeaders);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      clearSession();
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    if (!error.response && error.code === 'ERR_NETWORK') {
      error.message = 'Không kết nối được máy chủ Backend VIPLIKE (:3100). Hãy kiểm tra backend đang chạy.';
    }
    if (error.code === 'ECONNABORTED') {
      error.message = 'Yêu cầu quá thời gian chờ (Timeout).';
    }
    return Promise.reject(error);
  }
);

export default api;
