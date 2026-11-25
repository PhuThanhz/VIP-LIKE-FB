import { useEffect, useRef } from 'react';

/**
 * setInterval that only runs while the tab is visible.
 * - Tab hidden: stops completely, no API calls / no re-renders.
 * - Back to the tab: calls once immediately, then continues on schedule.
 * The callback is always the latest one (kept in a ref), so it doesn't need to be in deps.
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
