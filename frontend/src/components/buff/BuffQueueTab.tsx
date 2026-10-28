import React, { useState, useMemo, useEffect } from 'react';
import axios from 'axios';
import {
  Card,
  Row,
  Col,
  Button,
  Tag,
  Table,
  Progress,
  Tooltip,
  Modal,
  Input,
  Select,
  Segmented,
  Badge,
  App,
  Switch,
  TimePicker,
  Radio,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import {
  ThunderboltOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  ReloadOutlined,
  PlusOutlined,
  ExportOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FieldTimeOutlined,
  RocketOutlined,
  SearchOutlined,
  LoadingOutlined,
  EyeOutlined,
  CopyOutlined,
  StopOutlined,
  UserOutlined,
  SmileOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;

export interface PageDetailItem {
  pageId?: string;
  pageName?: string;
  status: 'SUCCESS' | 'FAILED' | 'ERROR' | 'SKIPPED' | string;
  reaction?: string;
  comment?: string;
  error?: string | null;
  time?: string;
}

/** 75 -> "1p 15s", 3700 -> "1g 1p" */
export const formatDuration = (totalSec: number): string => {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}p ${sec % 60}s`;
  return `${Math.floor(m / 60)}g ${m % 60}p`;
};

/** Thời gian đã chạy và ước tính còn lại (theo tốc độ trung bình của bài đang chạy) */
const getRunTiming = (task: { startedAt?: string; progress?: { done: number; total: number } }, now: number) => {
  const started = task.startedAt ? new Date(task.startedAt).getTime() : 0;
  if (!started) return null;
  const elapsed = Math.max(0, (now - started) / 1000);
  const done = task.progress?.done || 0;
  const total = task.progress?.total || 0;
  const remaining = done > 0 && total > done ? (elapsed / done) * (total - done) : null;
  return { elapsed, remaining };
};

export interface QueueTask {
  id: string;
  targetUrl: string;
  normalizedUrl?: string;
  source?: string;
  monitorName?: string;
  topic?: string;
  targetLikes?: number | 'ALL';
  reactionType?: string;
  enableLike?: boolean;
  enableComment?: boolean;
  enableShare?: boolean;
  comments?: string[];
  delayMinutes?: number;
  speedMode?: string;
  cookieString?: string;
  viaName?: string;
  addedAt?: string;
  runAfter?: string;
  startedAt?: string;
  finishedAt?: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';
  progress?: {
    done: number;
    total: number;
    success?: number;
  };
  result?: {
    total: number;
    success: number;
    failed: number;
    durationSec?: number;
    message?: string;
  };
  pageDetails?: PageDetailItem[];
  error?: string | null;
  attempts?: number;
}

export interface BuffQueueTabProps {
  workerBaseUrl: string;
  queueItems: QueueTask[];
  fbAccounts?: any[];
  scannedPages?: any[];
  onRefresh: () => void;
  onRunNow: (id: string) => Promise<void> | void;
  onRetry: (id: string) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
  onClearCompleted: () => Promise<void> | void;
  onEmergencyStop?: () => Promise<void> | void;
  /** Mở tab Tạo mới ở chế độ "Đưa vào hàng đợi" */
  onCreateNew?: () => void;
  onResume?: () => Promise<void> | void;
  isEmergencyStopped?: boolean;
  totalAvailablePages?: number;
}

type FilterStatus = 'ALL' | 'RUNNING' | 'QUEUED' | 'COMPLETED' | 'FAILED';

export const REACTION_CONFIG: Record<
  string,
  { label: string; emoji: string; color: string; desc: string }
> = {
  RANDOM_POSITIVE: {
    label: 'Tự nhiên (Like + Love + Care)',
    emoji: '✨',
    color: 'cyan',
    desc: 'Hệ thống tự xoay vòng Like, Love, Care tự nhiên nhất',
  },
  LIKE: { label: 'Like (Thích)', emoji: '👍', color: 'blue', desc: '100% nút Thích' },
  LOVE: { label: 'Love (Yêu thích)', emoji: '❤️', color: 'rose', desc: '100% thả Tim đỏ' },
  CARE: { label: 'Care (Thương thương)', emoji: '🥰', color: 'amber', desc: '100% ôm tim' },
  HAHA: { label: 'Haha (Cười vui vẻ)', emoji: '😆', color: 'gold', desc: '100% cười lớn' },
  WOW: { label: 'Wow (Ngạc nhiên)', emoji: '😮', color: 'purple', desc: '100% ngạc nhiên' },
  SAD: { label: 'Sad (Buồn bã)', emoji: '😢', color: 'blue', desc: '100% mặt buồn' },
  ANGRY: { label: 'Angry (Phẫn nộ)', emoji: '😡', color: 'red', desc: '100% tức giận' },
  RANDOM_ALL: {
    label: 'Ngẫu nhiên tất cả',
    emoji: '🎲',
    color: 'geekblue',
    desc: 'Ngẫu nhiên cả 7 loại cảm xúc',
  },
};

export const BuffQueueTab: React.FC<BuffQueueTabProps> = ({
  workerBaseUrl,
  queueItems = [],
  fbAccounts = [],
  scannedPages = [],
  onRefresh,
  onRunNow,
  onRetry,
  onRemove,
  onClearCompleted,
  onEmergencyStop,
  onCreateNew,
  onResume,
  isEmergencyStopped = false,
  totalAvailablePages = 50,
}) => {
  const { message } = App.useApp();

  // Search & Filter state
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // Modal nạp bài

  // Modal xem chi tiết bài viết
  const [detailModalTask, setDetailModalTask] = useState<QueueTask | null>(null);

  // Auto-refresh interval (polling 3s khi có bài RUNNING)
  const hasRunning = useMemo(() => queueItems.some((it) => it.status === 'RUNNING'), [queueItems]);
  const hasQueued = useMemo(() => queueItems.some((it) => it.status === 'QUEUED'), [queueItems]);

  // Đồng hồ nhảy mỗi giây khi có bài đang chạy (để hiện thời gian đã chạy / còn lại)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasRunning]);

  useEffect(() => {
    if (!hasRunning && !hasQueued) return;
    const intervalTime = hasRunning ? 3000 : 8000;
    const timer = setInterval(() => {
      onRefresh();
    }, intervalTime);
    return () => clearInterval(timer);
  }, [hasRunning, hasQueued, onRefresh]);

  // Metric counts
  const runningItems = useMemo(() => queueItems.filter((i) => i.status === 'RUNNING'), [queueItems]);
  const queuedItems = useMemo(
    () =>
      queueItems
        .filter((i) => i.status === 'QUEUED')
        .sort((a, b) => new Date(a.runAfter || 0).getTime() - new Date(b.runAfter || 0).getTime()),
    [queueItems]
  );
  const completedItems = useMemo(() => queueItems.filter((i) => i.status === 'COMPLETED'), [queueItems]);
  const failedItems = useMemo(
    () => queueItems.filter((i) => i.status === 'FAILED' || i.status === 'STOPPED'),
    [queueItems]
  );

  // Filtered items
  const filteredItems = useMemo(() => {
    return queueItems.filter((item) => {
      if (filterStatus === 'RUNNING' && item.status !== 'RUNNING') return false;
      if (filterStatus === 'QUEUED' && item.status !== 'QUEUED') return false;
      if (filterStatus === 'COMPLETED' && item.status !== 'COMPLETED') return false;
      if (filterStatus === 'FAILED' && item.status !== 'FAILED' && item.status !== 'STOPPED') return false;

      if (searchKeyword.trim()) {
        const kw = searchKeyword.trim().toLowerCase();
        const matchUrl = (item.targetUrl || '').toLowerCase().includes(kw);
        const matchMonitor = (item.monitorName || '').toLowerCase().includes(kw);
        const matchId = (item.id || '').toLowerCase().includes(kw);
        if (!matchUrl && !matchMonitor && !matchId) return false;
      }
      return true;
    });
  }, [queueItems, filterStatus, searchKeyword]);

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    message.success('Đã sao chép link bài viết!');
  };

  const formatScheduleTime = (runAfterStr?: string) => {
    if (!runAfterStr) return '—';
    const runTime = new Date(runAfterStr).getTime();
    const now = Date.now();
    const diffSec = Math.round((runTime - now) / 1000);

    if (diffSec <= 0) {
      return (
        <span className="text-emerald-400 font-semibold flex items-center gap-1">
          Sẵn sàng chạy
        </span>
      );
    }
    if (diffSec < 60) {
      return (
        <span className="text-amber-400 font-mono font-semibold flex items-center gap-1">
          Sau {diffSec}s
        </span>
      );
    }
    const diffMin = Math.round(diffSec / 60);
    return (
      <span className="text-amber-400 font-mono font-semibold flex items-center gap-1">
        Sau ~{diffMin}p ({new Date(runAfterStr).toLocaleTimeString()})
      </span>
    );
  };

  // Cột bảng hàng đợi
  const columns: ColumnsType<QueueTask> = [
    {
      title: 'Trạng Thái',
      key: 'status',
      width: 140,
      render: (_, task) => {
        if (task.status === 'RUNNING') {
          return (
            <div className="space-y-1">
              <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-blue-500/10 border-blue-500/30 text-blue-300">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1.5 align-middle" />
                Đang chạy
              </Tag>
              {task.progress && (
                <div className="text-[11px] font-mono text-cyan-300">
                  {task.progress.done} / {task.progress.total} Page
                </div>
              )}
            </div>
          );
        }
        if (task.status === 'QUEUED') {
          const queueIndex = queuedItems.findIndex((it) => it.id === task.id);
          return (
            <div className="space-y-1">
              <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-amber-500/10 border-amber-500/30 text-amber-300">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5 align-middle" />
                {queueIndex >= 0 ? `Chờ lượt #${queueIndex + 1}` : 'Đang chờ'}
              </Tag>
              <div className="text-[10px] text-slate-400 font-mono">
                {formatScheduleTime(task.runAfter)}
              </div>
            </div>
          );
        }
        if (task.status === 'COMPLETED') {
          return (
            <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
              Hoàn thành
            </Tag>
          );
        }
        return (
          <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-rose-500/10 border-rose-500/30 text-rose-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 mr-1.5 align-middle" />
            {task.status === 'STOPPED' ? 'Tạm dừng' : 'Thất bại'}
          </Tag>
        );
      },
    },
    {
      title: 'Bài Viết Facebook & Nguồn',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      render: (url: string, task) => {
        const isHunter = String(task.source || '').startsWith('POST_HUNTER');
        const isAutoOwn = task.source === 'AUTO_OWN_POST';
        const isBatch = task.source === 'BATCH_MANUAL';

        return (
          <div className="space-y-1 max-w-md">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag
                color={isHunter ? 'cyan' : isAutoOwn ? 'purple' : isBatch ? 'geekblue' : 'default'}
                className="text-[10px] m-0 font-medium border-0 rounded px-1.5 py-0"
              >
                {isHunter
                  ? `Săn bài${task.monitorName ? `: ${task.monitorName}` : ''}`
                  : isAutoOwn
                  ? `Bài tự đăng`
                  : isBatch
                  ? `Nạp hàng loạt`
                  : `Thủ công`}
              </Tag>
              {task.speedMode && (
                <Tag
                  color={task.speedMode === 'TURBO' ? 'red' : 'green'}
                  className="text-[9px] m-0 font-mono px-1 py-0 rounded border-0"
                >
                  {task.speedMode}
                </Tag>
              )}
              {task.addedAt && (
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(task.addedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-cyan-300 font-mono block truncate max-w-xs hover:underline"
                title={url}
              >
                {url}
              </a>
              <Tooltip title="Sao chép link">
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined className="text-slate-400 hover:text-cyan-400 text-xs" />}
                  onClick={() => handleCopyLink(url)}
                />
              </Tooltip>
              <Tooltip title="Mở bài trên Facebook">
                <Button
                  type="text"
                  size="small"
                  icon={<ExportOutlined className="text-slate-400 hover:text-blue-400 text-xs" />}
                  onClick={() => window.open(url, '_blank')}
                />
              </Tooltip>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Cảm Xúc & Số Lượng Page',
      key: 'config',
      width: 200,
      render: (_, task) => {
        const reactionObj = REACTION_CONFIG[task.reactionType || 'RANDOM_POSITIVE'] || {
          label: task.reactionType || 'Like',
          emoji: '👍',
          color: 'blue',
        };

        const commentCount = Array.isArray(task.comments) ? task.comments.length : 0;

        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-base">{reactionObj.emoji}</span>
              <span className="text-xs font-semibold text-slate-200 truncate">
                {reactionObj.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag color="blue" className="text-[10px] m-0 font-mono border-0 rounded px-1.5 py-0">
                {task.targetLikes === 'ALL' ? 'Toàn bộ dàn Page' : `${task.targetLikes || 30} Page`}
              </Tag>
              {task.enableComment && (
                <Tag color="purple" className="text-[10px] m-0 font-mono border-0 rounded px-1.5 py-0">
                  {commentCount > 0 ? `${commentCount} bình luận` : 'Bình luận'}
                </Tag>
              )}
              {task.enableShare && (
                <Tag color="green" className="text-[10px] m-0 font-mono border-0 rounded px-1.5 py-0">
                  Chia sẻ
                </Tag>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Tiến Độ / Kết Quả',
      key: 'progress',
      width: 180,
      render: (_, task) => {
        if (task.status === 'RUNNING') {
          const done = task.progress?.done || 0;
          const total = task.progress?.total || 1;
          const pct = Math.min(100, Math.round((done / total) * 100));

          return (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-cyan-400 font-bold font-mono">
                  {done} / {total} Page
                </span>
                <span className="text-cyan-300 font-mono font-semibold">{pct}%</span>
              </div>
              <Progress
                percent={pct}
                size="small"
                status="active"
                strokeColor={{
                  '0%': '#06b6d4',
                  '100%': '#3b82f6',
                }}
              />
              {(() => {
                const t = getRunTiming(task, now);
                return t ? (
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    Đã chạy {formatDuration(t.elapsed)}
                    {t.remaining !== null && ` · còn khoảng ${formatDuration(t.remaining)}`}
                  </div>
                ) : null;
              })()}
            </div>
          );
        }

        if (task.status === 'COMPLETED' && task.result) {
          const duration = task.result.durationSec ? formatDuration(task.result.durationSec) : '';
          return (
            <div className="space-y-1">
              <div className="text-xs text-slate-200">
                <span className="font-semibold text-emerald-400">{task.result.success}</span>
                <span className="text-slate-500"> / {task.result.total} thành công</span>
              </div>
              {duration && (
                <div className="text-[11px] text-slate-500">Thời gian: {duration}</div>
              )}
            </div>
          );
        }

        if (task.status === 'FAILED' && task.error) {
          return (
            <Tooltip title={task.error}>
              <div className="text-rose-400 text-xs truncate max-w-[160px] bg-rose-950/20 p-1.5 rounded border border-rose-800/30">
                {task.error}
              </div>
            </Tooltip>
          );
        }

        return <span className="text-slate-500 text-xs">Chờ lượt xử lý</span>;
      },
    },
    {
      title: 'Thao Tác',
      key: 'actions',
      width: 170,
      align: 'right',
      render: (_, task) => (
        <div className="flex items-center justify-end gap-1.5">
          {/* Nút Xem Chi Tiết */}
          <Button size="small" type="text" onClick={() => setDetailModalTask(task)} className="text-xs text-slate-300 px-2">
            Chi tiết
          </Button>

          {task.status === 'QUEUED' && (
            <Tooltip title="Chạy ngay lập tức">
              <Button size="small" onClick={() => onRunNow(task.id)} className="text-xs px-2.5">
                Chạy ngay
              </Button>
            </Tooltip>
          )}

          {task.status === 'FAILED' && (
            <Tooltip title="Chạy lại bài này">
              <Button size="small" onClick={() => onRetry(task.id)} className="text-xs px-2.5">
                Thử lại
              </Button>
            </Tooltip>
          )}

          <Tooltip title="Xoá khỏi hàng đợi">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onRemove(task.id)}
              className="text-slate-400 hover:text-rose-400"
            />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* 1. Header Banner & Queue Control */}
      <div className="app-surface p-4 sm:p-5 rounded-2xl border border-slate-800/80 bg-slate-900/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold text-slate-100 m-0">Hàng đợi tự động</h2>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                  isEmergencyStopped ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isEmergencyStopped ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                {isEmergencyStopped ? 'Đang tạm dừng' : 'Đang hoạt động'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 mb-0 max-w-2xl">
              Bài viết được xử lý lần lượt theo lịch, chia đều cho {scannedPages.length || totalAvailablePages} Page.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {completedItems.length > 0 && (
              <Button type="text" onClick={onClearCompleted} className="text-slate-400 hover:text-slate-200">
                Dọn bài đã xong ({completedItems.length})
              </Button>
            )}
            <Button onClick={onRefresh}>
              Làm mới
            </Button>
            {isEmergencyStopped && onResume && (
              <Button onClick={onResume}>Tiếp tục</Button>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreateNew} className="font-medium">
              Thêm bài viết
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Metric Stat Cards */}
      <Row gutter={[12, 12]}>
        <Col xs={12} sm={6}>
          <div
            onClick={() => setFilterStatus('RUNNING')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterStatus === 'RUNNING'
                ? 'bg-slate-800/60 border-blue-500/70'
                : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">
                Đang chạy
              </span>
              {runningItems.length > 0 && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
                </span>
              )}
            </div>
            <div className="text-2xl font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
              <span>{runningItems.length}</span>
              <span className="text-xs font-normal text-slate-400">bài đang chạy</span>
            </div>
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div
            onClick={() => setFilterStatus('QUEUED')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterStatus === 'QUEUED'
                ? 'bg-slate-800/60 border-amber-500/70'
                : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">
                Đang chờ
              </span>
            </div>
            <div className="text-2xl font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
              <span>{queuedItems.length}</span>
              <span className="text-xs font-normal text-slate-400">bài trong hàng đợi</span>
            </div>
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div
            onClick={() => setFilterStatus('COMPLETED')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterStatus === 'COMPLETED'
                ? 'bg-slate-800/60 border-emerald-500/70'
                : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">
                Hoàn thành
              </span>
            </div>
            <div className="text-2xl font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
              <span>{completedItems.length}</span>
              <span className="text-xs font-normal text-slate-400">bài hoàn tất</span>
            </div>
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div
            onClick={() => setFilterStatus('FAILED')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterStatus === 'FAILED'
                ? 'bg-slate-800/60 border-rose-500/70'
                : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">
                Thất bại
              </span>
            </div>
            <div className="text-2xl font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
              <span>{failedItems.length}</span>
              <span className="text-xs font-normal text-slate-400">cần xem lại</span>
            </div>
          </div>
        </Col>
      </Row>

      {/* 3. Section "🔥 ĐANG BUFF TRỰC TIẾP" */}
      {runningItems.length > 0 && (
        <Card
          className="app-surface border border-cyan-500/40 bg-gradient-to-r from-blue-950/30 via-slate-900 to-cyan-950/30 rounded-2xl shadow-md"
          title={
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                </span>
                <span className="text-sm font-bold text-slate-100">
                  Tiến Trình Đang Buff Trực Tiếp ({runningItems.length} bài)
                </span>
              </div>
              <span className="text-xs font-mono text-cyan-300">Tự động cập nhật mỗi 3s</span>
            </div>
          }
        >
          <div className="space-y-4">
            {runningItems.map((task) => {
              const done = task.progress?.done || 0;
              const total = task.progress?.total || 1;
              const pct = Math.min(100, Math.round((done / total) * 100));
              const reactionObj = REACTION_CONFIG[task.reactionType || 'RANDOM_POSITIVE'];

              return (
                <div
                  key={task.id}
                  className="p-4 rounded-xl bg-slate-900/90 border border-cyan-500/30 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Tag color="cyan" className="font-mono text-xs font-bold py-0.5 px-2">
                        {reactionObj?.emoji} {reactionObj?.label || 'Like'}
                      </Tag>
                      <a
                        href={task.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-cyan-300 font-mono font-medium truncate max-w-md block hover:underline"
                      >
                        {task.targetUrl}
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="small" type="text" onClick={() => setDetailModalTask(task)} className="text-xs text-slate-300">
                        Chi tiết
                      </Button>
                      <div className="text-xs font-mono text-cyan-300 font-bold shrink-0 text-right tabular-nums">
                        <div>{done} / {total} Page ({pct}%)</div>
                        {(() => {
                          const t = getRunTiming(task, now);
                          return t ? (
                            <div className="font-normal text-slate-400">
                              {formatDuration(t.elapsed)}
                              {t.remaining !== null && ` · còn ~${formatDuration(t.remaining)}`}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>

                  <Progress
                    percent={pct}
                    status="active"
                    strokeColor={{
                      '0%': '#06b6d4',
                      '50%': '#3b82f6',
                      '100%': '#8b5cf6',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 4. Danh Sách Bài Viết Trong Hàng Đợi */}
      <Card
        className="app-surface rounded-2xl border border-slate-800/80 shadow-lg p-0 overflow-hidden"
        title={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-100">
                Danh sách bài viết
              </span>
              <Badge
                count={filteredItems.length}
                overflowCount={999}
                style={{ backgroundColor: '#0284c7' }}
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Input
                placeholder="Tìm link bài viết..."
                prefix={<SearchOutlined className="text-slate-400" />}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                allowClear
                size="small"
                className="bg-slate-900 border-slate-700 text-slate-100 rounded-lg text-xs w-full sm:w-56"
              />
            </div>
          </div>
        }
      >
        {/* Bộ Lọc Tabs */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/40">
          <Segmented
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as FilterStatus)}
            options={[
              { label: `Tất cả (${queueItems.length})`, value: 'ALL' },
              { label: `Đang chạy (${runningItems.length})`, value: 'RUNNING' },
              { label: `Đang chờ (${queuedItems.length})`, value: 'QUEUED' },
              { label: `Hoàn thành (${completedItems.length})`, value: 'COMPLETED' },
              { label: `Thất bại (${failedItems.length})`, value: 'FAILED' },
            ]}
            className="bg-slate-950 border border-slate-800 text-xs"
          />
        </div>

        {/* Bảng dữ liệu */}
        <Table
          dataSource={filteredItems}
          columns={columns}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total) => `Tổng cộng ${total} bài viết`,
          }}
          scroll={{ x: 920 }}
          className="ant-table-dark-custom"
          locale={{
            emptyText: (
              <div className="py-16 text-center text-slate-400 text-xs space-y-2">
                <FieldTimeOutlined className="text-3xl text-slate-600 block mb-2" />
                <div className="font-semibold text-slate-300">Hàng đợi đang trống</div>
                <p className="max-w-md mx-auto text-slate-500">
                  Bấm <strong>"Thêm bài viết"</strong>, chọn "Đưa vào hàng đợi" ở tab Tạo mới.
                </p>
              </div>
            ),
          }}
        />
      </Card>

      {/* 6. MODAL XEM CHI TIẾT BÀI VIẾT (DANH SÁCH TỪNG PAGE ĐÃ/ĐANG BUFF) */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-100">
            <UnorderedListOutlined className="text-cyan-400" />
            <span>Chi Tiết Lượt Buff & Danh Sách Fanpage</span>
          </div>
        }
        open={Boolean(detailModalTask)}
        onCancel={() => setDetailModalTask(null)}
        footer={[
          <Button key="close" onClick={() => setDetailModalTask(null)} className="text-xs">
            Đóng
          </Button>,
          detailModalTask?.status === 'QUEUED' && (
            <Button
              key="runNow"
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => {
                if (detailModalTask) onRunNow(detailModalTask.id);
                setDetailModalTask(null);
              }}
              className="bg-amber-600 hover:bg-amber-500 text-xs"
            >
              Kích hoạt chạy ngay
            </Button>
          ),
        ]}
        width={780}
        className="dark-modal"
      >
        {detailModalTask && (
          <div className="space-y-4 py-2 text-xs">
            {/* Thông tin bài viết */}
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300">Link Bài Viết Facebook:</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => handleCopyLink(detailModalTask.targetUrl)}
                    className="text-[11px]"
                  >
                    Sao chép
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<ExportOutlined />}
                    onClick={() => window.open(detailModalTask.targetUrl, '_blank')}
                    className="text-[11px] bg-blue-600"
                  >
                    Mở bài viết
                  </Button>
                </div>
              </div>
              <div className="font-mono text-cyan-400 break-all bg-slate-950 p-2 rounded border border-slate-800">
                {detailModalTask.targetUrl}
              </div>
            </div>

            {/* Thông số kỹ thuật */}
            <Row gutter={[12, 12]}>
              <Col xs={12} sm={6}>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Trạng Thái</div>
                  <div className="mt-1 font-bold">
                    {detailModalTask.status === 'RUNNING' ? (
                      <Tag color="processing" icon={<LoadingOutlined spin />}>Đang Buff</Tag>
                    ) : detailModalTask.status === 'QUEUED' ? (
                      <Tag color="warning">Chờ Lượt</Tag>
                    ) : detailModalTask.status === 'COMPLETED' ? (
                      <Tag color="success">Hoàn Thành</Tag>
                    ) : (
                      <Tag color="error">Thất Bại</Tag>
                    )}
                  </div>
                </div>
              </Col>

              <Col xs={12} sm={6}>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Cảm Xúc</div>
                  <div className="mt-1 font-semibold text-slate-200 flex items-center gap-1">
                    <span>{REACTION_CONFIG[detailModalTask.reactionType || 'RANDOM_POSITIVE']?.emoji}</span>
                    <span className="truncate">
                      {REACTION_CONFIG[detailModalTask.reactionType || 'RANDOM_POSITIVE']?.label || detailModalTask.reactionType}
                    </span>
                  </div>
                </div>
              </Col>

              <Col xs={12} sm={6}>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Số Lượng Like</div>
                  <div className="mt-1 font-mono font-bold text-blue-400">
                    {detailModalTask.targetLikes === 'ALL' ? 'Toàn bộ Page' : `${detailModalTask.targetLikes || 30} Page`}
                  </div>
                </div>
              </Col>

              <Col xs={12} sm={6}>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Lịch Hẹn Chạy</div>
                  <div className="mt-1 font-mono text-amber-400 font-semibold truncate">
                    {detailModalTask.runAfter ? new Date(detailModalTask.runAfter).toLocaleTimeString() : '—'}
                  </div>
                </div>
              </Col>
            </Row>

            {/* Tiến trình thành công */}
            {detailModalTask.result && (
              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between">
                <div>
                  <span className="font-bold text-emerald-300">Kết quả thực hiện:</span>
                  <span className="text-slate-300 ml-2">
                    Thành công <strong>{detailModalTask.result.success}</strong> / {detailModalTask.result.total} Page
                    (Thất bại: {detailModalTask.result.failed})
                  </span>
                </div>
                {detailModalTask.result.durationSec && (
                  <span className="font-mono text-slate-400">
                    Thời gian: {formatDuration(detailModalTask.result.durationSec)}
                  </span>
                )}
              </div>
            )}

            {/* Danh sách từng Fanpage con đã thực hiện */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">
                  Danh Sách Từng Fanpage Đã Thực Hiện (
                  {detailModalTask.pageDetails?.length || 0} lượt ghi nhận):
                </span>
                <span className="text-[11px] text-slate-400">Ghi nhận theo thời gian thực</span>
              </div>

              {detailModalTask.pageDetails && detailModalTask.pageDetails.length > 0 ? (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 text-[11px] uppercase border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="p-2">#</th>
                        <th className="p-2">Fanpage Con</th>
                        <th className="p-2">Cảm Xúc</th>
                        <th className="p-2">Trạng Thái</th>
                        <th className="p-2">Thời Gian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {detailModalTask.pageDetails.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/40">
                          <td className="p-2 text-slate-500">{idx + 1}</td>
                          <td className="p-2 font-semibold text-slate-200">
                            {item.pageName || item.pageId || 'Fanpage'}
                          </td>
                          <td className="p-2">
                            <span>{REACTION_CONFIG[item.reaction || '']?.emoji || '👍'}</span>
                          </td>
                          <td className="p-2">
                            {item.status === 'SUCCESS' ? (
                              <Tag color="success" className="text-[10px] m-0 border-0">
                                ✅ Thành công
                              </Tag>
                            ) : (
                              <Tag color="error" className="text-[10px] m-0 border-0">
                                ❌ {item.error || 'Lỗi'}
                              </Tag>
                            )}
                          </td>
                          <td className="p-2 text-slate-400">{item.time || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-slate-500 bg-slate-900/40 rounded-lg border border-slate-800/80">
                  {detailModalTask.status === 'QUEUED'
                    ? 'Bài viết đang nằm trong hàng đợi. Khi đến giờ chạy, danh sách từng Fanpage con like bài sẽ xuất hiện trực tiếp ở đây.'
                    : 'Chưa có nhật ký chi tiết cho bài viết này.'}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default BuffQueueTab;
