import axios from 'axios';

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

export const SPRING_API_BASE_URL =
  import.meta.env.VITE_SPRING_API_BASE_URL ||
  `http://${getSafeHost()}:8080/api`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 180000, // 3 phút cho các tác vụ Playwright
});

// Tự động gắn Token JWT và Hardware HWID cho instance api
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('viplike_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const hwid = localStorage.getItem('viplike_hwid');
  if (hwid && config.headers) {
    config.headers['X-Hardware-HWID'] = hwid;
  }
  return config;
});

// Tự động gắn Token JWT cho cả axios mặc định (phòng trường hợp component gọi axios trực tiếp)
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('viplike_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const hwid = localStorage.getItem('viplike_hwid');
  if (hwid && config.headers) {
    config.headers['X-Hardware-HWID'] = hwid;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('viplike_token');
      localStorage.removeItem('viplike_user');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('viplike_auth_expired'));
      }
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

// Axios instance riêng cho Java Spring Boot (Port 8080)
export const springApi = axios.create({
  baseURL: SPRING_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

springApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('viplike_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

