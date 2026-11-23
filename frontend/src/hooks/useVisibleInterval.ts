import { useEffect, useRef } from 'react';

/**
 * setInterval chỉ chạy khi tab đang hiển thị.
 * - Tab bị ẩn: dừng hẳn, không gọi API / không render lại.
 * - Quay lại tab: gọi ngay 1 lần rồi chạy tiếp theo chu kỳ.
 * Callback luôn là bản mới nhất (lưu qua ref) nên không cần đưa vào deps.
 */
export function useVisibleInterval(callback: () => void, delayMs: number | null) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(() => savedCallback.current(), delayMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        savedCallback.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [delayMs]);
}
