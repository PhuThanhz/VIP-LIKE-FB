import { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import { isTauri } from '../../utils/tauriBridge';

interface AppVersionProps {
  compact?: boolean;
  className?: string;
}

/**
 * Version number + build time, shown at the bottom of the menu so you can tell whether the user's machine is up to date.
 * Desktop: reads the installed version (getVersion) and asks the updater whether a newer one exists.
 */
export default function AppVersion({ compact = false, className = '' }: AppVersionProps) {
  const [version, setVersion] = useState<string>(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
  );
  const [latest, setLatest] = useState<string | null>(null);
  const builtAt = typeof __BUILD_TIME__ !== 'undefined' ? dayjs(__BUILD_TIME__) : null;

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const v = await getVersion();
        if (!cancelled && v) setVersion(v);
      } catch {
        // Keep the default __APP_VERSION__
      }

      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!cancelled && update && update.available) {
          setLatest(update.version);
        }
      } catch {
        // No network / updater not configured
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const label = version === 'dev' ? 'Dev build' : `v${version}`;
  const tip = [
    `Version ${version}`,
    builtAt && builtAt.isValid() ? `Built at ${builtAt.format('HH:mm DD/MM/YYYY')}` : null,
    latest
      ? `Version ${latest} is available — reopen the app or click update`
      : isTauri()
      ? 'You are on the latest version'
      : 'Web browser mode',
  ]
    .filter(Boolean)
    .join('\n');

  if (compact) {
    return (
      <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>} placement="right">
        <div className={`flex flex-col items-center justify-center py-2 cursor-default ${className}`}>
          <span className="text-[10px] font-mono font-medium text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60">
            {label}
          </span>
          {latest && (
            <span className="relative flex h-2 w-2 mt-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          )}
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>} placement="top">
      <div
        className={`flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-900/60 border border-slate-800/80 rounded-lg px-2.5 py-1.5 select-none hover:border-slate-700 transition-colors cursor-default ${className}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-slate-200">{label}</span>
          {builtAt && builtAt.isValid() && (
            <span className="text-slate-500 text-[10px] truncate">· {builtAt.format('HH:mm DD/MM')}</span>
          )}
        </div>

        {latest ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded-full animate-pulse shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            v{latest}
          </span>
        ) : (
          <span className="text-[10px] text-slate-500 shrink-0">latest</span>
        )}
      </div>
    </Tooltip>
  );
}
