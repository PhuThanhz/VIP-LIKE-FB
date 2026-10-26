import axios from 'axios';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3100/api`;

export const WORKER_BASE_URL =
  import.meta.env.VITE_WORKER_BASE_URL ||
  `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3100`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 180000, // 3 phút cho các tác vụ Playwright
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
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
