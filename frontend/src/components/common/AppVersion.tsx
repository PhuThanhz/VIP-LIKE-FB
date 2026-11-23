import { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import { isTauri } from '../../utils/tauriBridge';

interface AppVersionProps {
  compact?: boolean;
  className?: string;
}

/**
 * Số phiên bản + giờ build, hiện ở cuối menu để biết máy người dùng đã cập nhật chưa.
 * Desktop: đọc phiên bản đang cài (getVersion) và hỏi bộ cập nhật xem có bản mới hơn không.
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
        // Giữ __APP_VERSION__ mặc định
      }

      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!cancelled && update && update.available) {
          setLatest(update.version);
        }
      } catch {
        // Chưa có mạng / chưa cấu hình updater
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const label = version === 'dev' ? 'Bản dev' : `v${version}`;
  const tip = [
    `Phiên bản ${version}`,
    builtAt && builtAt.isValid() ? `Build lúc ${builtAt.format('HH:mm DD/MM/YYYY')}` : null,
    latest
      ? `Đã có bản ${latest} — mở lại app hoặc bấm cập nhật`
      : isTauri()
      ? 'Đang dùng bản mới nhất'
      : 'Chế độ Trình duyệt Web',
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
            bản {latest}
          </span>
        ) : (
          <span className="text-[10px] text-slate-500 shrink-0">mới nhất</span>
        )}
      </div>
    </Tooltip>
  );
}
