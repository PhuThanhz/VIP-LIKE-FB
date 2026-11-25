import React, { useEffect, useState } from 'react';
import { Button, Spin } from 'antd';
import { API_BASE_URL } from '../../config/axios';
import { getBackendStatus, isTauri, startBackend } from '../../utils/tauriBridge';

/**
 * Desktop app only: holds the UI until the bundled backend answers /api/health,
 * so the login check does not fail (and log the user out) while Node is still starting.
 * In a regular browser it renders children immediately.
 */
const MESSAGES: Record<string, string> = {
  starting: 'Starting local server...',
  installing_browser: 'First launch: downloading the Chromium browser (~150MB), please wait...',
  running: 'Starting local server...',
  external: 'Connecting to server...',
  missing: 'Waiting for the backend at 127.0.0.1:3100...',
};

const isUp = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.status === 'UP';
  } catch {
    return false;
  }
};

export const BackendGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState<boolean>(!isTauri());
  const [status, setStatus] = useState<string>('starting');

  useEffect(() => {
    if (ready) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (await isUp()) {
        setReady(true);
        return;
      }
      setStatus(await getBackendStatus());
      setTimeout(tick, 1000);
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [ready]);

  if (ready) return <>{children}</>;

  const isError = status.startsWith('error');
  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center gap-3 px-6 text-center">
      {!isError && <Spin size="large" />}
      <span className={`text-xs font-mono ${isError ? 'text-red-400' : 'text-cyan-400'}`}>
        {isError ? 'Could not start the local server:' : MESSAGES[status] || MESSAGES.starting}
      </span>
      {isError && (
        <pre className="max-w-[900px] max-h-[50vh] overflow-auto whitespace-pre-wrap text-left text-[11px] font-mono text-red-300 bg-black/40 rounded p-3 select-text">
          {status.replace(/^error:\s*/, '')}
          {'\n\nLogs: %APPDATA%\\com.viplike.radiant\\logs\\backend.log'}
        </pre>
      )}
      {isError && (
        <Button size="small" onClick={() => { setStatus('starting'); startBackend(); }}>
          Retry
        </Button>
      )}
    </div>
  );
};

export default BackendGate;
