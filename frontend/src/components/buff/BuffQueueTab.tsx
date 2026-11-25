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
  InputNumber,
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
  HistoryOutlined,
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

/** Elapsed time and estimated time left (based on the running post's average speed) */
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
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'DEAD_LETTER' | 'NEEDS_REVIEW' | 'STOPPED';
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
    note?: string;
  };
  pageDetails?: PageDetailItem[];
  error?: string | null;
  attempts?: number;
  stopRequested?: boolean;
}

export interface BuffQueueTabProps {
  workerBaseUrl: string;
  queueItems: QueueTask[];
  fbAccounts?: any[];
  scannedPages?: any[];
  onRefresh: () => void;
  onRunNow: (id: string) => Promise<void> | void;
  onRetry: (id: string) => Promise<void> | void;
  onStop?: (id: string) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
  onClearCompleted: () => Promise<void> | void;
  onClearAll?: () => Promise<void> | void;
  onEmergencyStop?: () => Promise<void> | void;
  /** Open the New tab in "Add to queue" mode */
  onCreateNew?: () => void;
  onResume?: () => Promise<void> | void;
  isEmergencyStopped?: boolean;
  totalAvailablePages?: number;
  maxParallelTasks?: number;
  onViewHistory?: (targetUrl?: string) => void;
}

type FilterStatus = 'ALL' | 'RUNNING' | 'QUEUED' | 'COMPLETED' | 'FAILED';

export const REACTION_CONFIG: Record<
  string,
  { label: string; emoji: string; color: string; desc: string }
> = {
  RANDOM_POSITIVE: {
    label: 'Natural (Like + Love + Care)',
    emoji: '✨',
    color: 'cyan',
    desc: 'The system rotates Like, Love and Care as naturally as possible',
  },
  LIKE: { label: 'Like', emoji: '👍', color: 'blue', desc: '100% Like button' },
  LOVE: { label: 'Love', emoji: '❤️', color: 'rose', desc: '100% red heart' },
  CARE: { label: 'Care', emoji: '🥰', color: 'amber', desc: '100% hugging heart' },
  HAHA: { label: 'Haha', emoji: '😆', color: 'gold', desc: '100% laughing' },
  WOW: { label: 'Wow', emoji: '😮', color: 'purple', desc: '100% surprised' },
  SAD: { label: 'Sad', emoji: '😢', color: 'blue', desc: '100% sad face' },
  ANGRY: { label: 'Angry', emoji: '😡', color: 'red', desc: '100% angry' },
  RANDOM_ALL: {
    label: 'Random (all)',
    emoji: '🎲',
    color: 'geekblue',
    desc: 'Random across all 7 reactions',
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
  onStop,
  onRemove,
  onClearCompleted,
  onClearAll,
  onEmergencyStop,
  onCreateNew,
  onResume,
  isEmergencyStopped = false,
  totalAvailablePages = 50,
  maxParallelTasks = 2,
  onViewHistory,
}) => {
  const { message } = App.useApp();

  // Search & Filter state
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // Quick-add posts to the queue modal
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false);
  const [quickAddMode, setQuickAddMode] = useState<'SINGLE' | 'BATCH'>('SINGLE');
  const [quickTargetUrl, setQuickTargetUrl] = useState('');
  const [quickBatchUrls, setQuickBatchUrls] = useState('');
  const [quickTargetLikes, setQuickTargetLikes] = useState<number | 'ALL'>(30);
  const [quickReaction, setQuickReaction] = useState('RANDOM_POSITIVE');
  const [quickDelayMinutes, setQuickDelayMinutes] = useState(0);
  const [quickSpeedMode, setQuickSpeedMode] = useState<'NORMAL' | 'FAST' | 'SMART' | 'SAFE'>('NORMAL');
  const [isSubmittingQuickAdd, setIsSubmittingQuickAdd] = useState(false);

  // Post detail modal
  const [detailModalTask, setDetailModalTask] = useState<QueueTask | null>(null);

  // Quick paste of a link from the clipboard
  const handlePasteQuickUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.includes('facebook.com') || text.includes('fb.watch') || text.includes('fb.com'))) {
        if (quickAddMode === 'SINGLE') {
          setQuickTargetUrl(text.trim());
        } else {
          setQuickBatchUrls((prev) => (prev ? `${prev}\n${text.trim()}` : text.trim()));
        }
        message.success('Facebook link pasted from the clipboard!');
      } else if (text) {
        if (quickAddMode === 'SINGLE') setQuickTargetUrl(text.trim());
        else setQuickBatchUrls((prev) => (prev ? `${prev}\n${text.trim()}` : text.trim()));
      }
    } catch {
      message.info('Please press Ctrl+V (or Cmd+V) to paste the link');
    }
  };

  // Submit a quick add to the queue
  const handleQuickAddSubmit = async () => {
    if (quickAddMode === 'SINGLE') {
      const trimmedUrl = quickTargetUrl.trim();
      if (!trimmedUrl) {
        message.warning('Please enter a Facebook post link!');
        return;
      }
      setIsSubmittingQuickAdd(true);
      try {
        const res = await axios.post(`${workerBaseUrl}/api/buff-queue/add`, {
          targetUrl: trimmedUrl,
          targetLikes: quickTargetLikes,
          reactionType: quickReaction,
          delayMinutes: quickDelayMinutes,
          speedMode: quickSpeedMode,
          allowRebuff: true,
          source: 'MANUAL_QUICK_ADD',
        });
        if (res.data?.success) {
          message.success(
            res.data.alreadyQueued
              ? 'This post is already in the queue'
              : 'Post added to the processing queue!'
          );
          setIsQuickAddModalOpen(false);
          setQuickTargetUrl('');
          onRefresh();
        } else {
          message.error(res.data?.error || 'Could not add to the queue');
        }
      } catch (err: any) {
        message.error(err.response?.data?.error || err.message || 'Server connection error');
      } finally {
        setIsSubmittingQuickAdd(false);
      }
    } else {
      const lines = quickBatchUrls
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('http://') || l.startsWith('https://'));

      if (lines.length === 0) {
        message.warning('Please enter at least 1 valid Facebook link (starting with http/https)!');
        return;
      }

      setIsSubmittingQuickAdd(true);
      try {
        const res = await axios.post(`${workerBaseUrl}/api/buff-queue/batch-add`, {
          urls: lines,
          targetLikes: quickTargetLikes,
          reactionType: quickReaction,
          delayMinutes: quickDelayMinutes,
          speedMode: quickSpeedMode,
          staggerMinutes: 2,
          allowRebuff: true,
        });
        if (res.data?.success) {
          const addedCount = res.data.added?.length || lines.length;
          const skippedCount = res.data.skipped?.length || 0;
          message.success(
            `Added ${addedCount} posts to the queue!` +
              (skippedCount > 0 ? ` (skipped ${skippedCount} duplicates)` : '')
          );
          setIsQuickAddModalOpen(false);
          setQuickBatchUrls('');
          onRefresh();
        } else {
          message.error(res.data?.error || 'Error adding the post list');
        }
      } catch (err: any) {
        message.error(err.response?.data?.error || err.message || 'Server connection error');
      } finally {
        setIsSubmittingQuickAdd(false);
      }
    }
  };

  // Auto-refresh interval (polls every 3s while a post is RUNNING)
  const hasRunning = useMemo(() => queueItems.some((it) => it.status === 'RUNNING'), [queueItems]);
  const hasQueued = useMemo(() => queueItems.some((it) => it.status === 'QUEUED'), [queueItems]);

  // Clock ticks every second while a post is running (to show elapsed / remaining time)
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
  const completedItems = useMemo(() => queueItems.filter((i) => i.status === 'COMPLETED' || i.status === 'PARTIAL'), [queueItems]);
  const failedItems = useMemo(
    () => queueItems.filter((i) => i.status === 'FAILED' || i.status === 'DEAD_LETTER' || i.status === 'STOPPED'),
    [queueItems]
  );

  // Extract a timestamp to sort the newest queue tasks first
  const getTaskTimestamp = (t: QueueTask): number => {
    if (t.addedAt) {
      const ms = new Date(t.addedAt).getTime();
      if (!isNaN(ms)) return ms;
    }
    if (t.startedAt) {
      const ms = new Date(t.startedAt).getTime();
      if (!isNaN(ms)) return ms;
    }
    if (t.finishedAt) {
      const ms = new Date(t.finishedAt).getTime();
      if (!isNaN(ms)) return ms;
    }
    if (t.id && t.id.startsWith('task_')) {
      const parts = t.id.split('_');
      const ts = parseInt(parts[1], 10);
      if (!isNaN(ts)) return ts;
    }
    return 0;
  };

  // Filtered items (always sorted newest first so they're easy to check)
  const filteredItems = useMemo(() => {
    return queueItems
      .filter((item) => {
        if (filterStatus === 'RUNNING' && item.status !== 'RUNNING') return false;
        if (filterStatus === 'QUEUED' && item.status !== 'QUEUED') return false;
        if (filterStatus === 'COMPLETED' && item.status !== 'COMPLETED' && item.status !== 'PARTIAL') return false;
        if (filterStatus === 'FAILED' && item.status !== 'FAILED' && item.status !== 'DEAD_LETTER' && item.status !== 'STOPPED') return false;

        if (searchKeyword.trim()) {
          const kw = searchKeyword.trim().toLowerCase();
          const matchUrl = (item.targetUrl || '').toLowerCase().includes(kw);
          const matchMonitor = (item.monitorName || '').toLowerCase().includes(kw);
          const matchId = (item.id || '').toLowerCase().includes(kw);
          if (!matchUrl && !matchMonitor && !matchId) return false;
        }
        return true;
      })
      .sort((a, b) => getTaskTimestamp(b) - getTaskTimestamp(a));
  }, [queueItems, filterStatus, searchKeyword]);

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    message.success('Post link copied!');
  };

  const formatScheduleTime = (runAfterStr?: string) => {
    if (!runAfterStr) return '—';
    const runTime = new Date(runAfterStr).getTime();
    const now = Date.now();
    const diffSec = Math.round((runTime - now) / 1000);

    if (diffSec <= 0) {
      return (
        <span className="text-emerald-400 font-semibold flex items-center gap-1">
          Ready to run
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

  // Queue table columns
  const columns: ColumnsType<QueueTask> = [
    {
      title: 'Status',
      key: 'status',
      width: 140,
      render: (_, task) => {
        if (task.status === 'RUNNING') {
          return (
            <div className="space-y-1">
              <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-blue-500/10 border-blue-500/30 text-blue-300">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1.5 align-middle" />
                Running
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
                {queueIndex >= 0 ? `Queued #${queueIndex + 1}` : 'Waiting'}
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
              Completed
            </Tag>
          );
        }
        if (task.status === 'PARTIAL') {
          return (
            <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-amber-500/10 border-amber-500/30 text-amber-300">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5 align-middle" />
              Partially done
            </Tag>
          );
        }
        if (task.status === 'STOPPED') {
          return (
            <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-slate-500/10 border-slate-500/30 text-slate-300">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5 align-middle" />
              Paused
            </Tag>
          );
        }
        if (task.status === 'NEEDS_REVIEW') {
          return (
            <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-purple-500/10 border-purple-500/30 text-purple-300">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 mr-1.5 align-middle" />
              Needs review
            </Tag>
          );
        }
        return (
          <Tag className="font-medium text-xs py-0.5 px-2 rounded-md m-0 bg-rose-500/10 border-rose-500/30 text-rose-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 mr-1.5 align-middle" />
            Failed
          </Tag>
        );
      },
    },
    {
      title: 'Facebook Post & Source',
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
                  ? `Post Hunter${task.monitorName ? `: ${task.monitorName}` : ''}`
                  : isAutoOwn
                  ? `Self-posted`
                  : isBatch
                  ? `Bulk add`
                  : `Manual`}
              </Tag>
              {task.speedMode && (
                <Tag
                  color={task.speedMode === 'SMART' ? 'cyan' : task.speedMode === 'TURBO' ? 'red' : task.speedMode === 'SAFE' ? 'gold' : 'green'}
                  className="text-[9px] m-0 font-mono px-1.5 py-0 rounded border-0"
                >
                  {task.speedMode === 'SMART' ? '🛡️ SMART' : task.speedMode}
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
              <Tooltip title="Copy link">
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined className="text-slate-400 hover:text-cyan-400 text-xs" />}
                  onClick={() => handleCopyLink(url)}
                />
              </Tooltip>
              <Tooltip title="Open the post on Facebook">
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
      title: 'Reaction & Page Count',
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
                {task.targetLikes === 'ALL' ? 'All Pages' : `${task.targetLikes || 30} Pages`}
              </Tag>
              {task.enableComment && (
                <Tag color="purple" className="text-[10px] m-0 font-mono border-0 rounded px-1.5 py-0">
                  {commentCount > 0 ? `${commentCount} comments` : 'Comments'}
                </Tag>
              )}
              {task.enableShare && (
                <Tag color="green" className="text-[10px] m-0 font-mono border-0 rounded px-1.5 py-0">
                  Share
                </Tag>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Progress / Result',
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
                    Running for {formatDuration(t.elapsed)}
                    {t.remaining !== null && ` · about ${formatDuration(t.remaining)} left`}
                  </div>
                ) : null;
              })()}
            </div>
          );
        }

        if ((task.status === 'COMPLETED' || task.status === 'PARTIAL') && task.result) {
          const duration = task.result.durationSec ? formatDuration(task.result.durationSec) : '';
          const targetKpi = (task.result as any).targetKpi || (task.targetLikes === 'ALL' ? task.result.total : task.targetLikes);
          const autoRefilled = (task.result as any).autoRefilledCount || 0;
          const isPartial = task.status === 'PARTIAL';
          return (
            <div className="space-y-1">
              <div className="text-xs text-slate-200">
                <span className={`font-semibold ${isPartial ? 'text-amber-400' : 'text-emerald-400'}`}>{task.result.success}</span>
                <span className="text-slate-500"> / {targetKpi || task.result.total} like</span>
              </div>
              {autoRefilled > 0 && (
                <div className="text-[10px] text-amber-400/90 font-medium">
                  ⚡ Auto-replaced {autoRefilled} failed Pages
                </div>
              )}
              {duration && (
                <div className="text-[11px] text-slate-500">Duration: {duration}</div>
              )}
              {task.result?.note && (
                <div className="text-[10px] text-slate-400 italic truncate max-w-[170px]" title={task.result.note}>
                  {task.result.note}
                </div>
              )}
            </div>
          );
        }

        if ((task.status === 'FAILED' || task.status === 'DEAD_LETTER') && task.error) {
          return (
            <Tooltip title={task.error}>
              <div className="text-rose-400 text-xs truncate max-w-[180px] bg-rose-950/20 p-1.5 rounded border border-rose-800/30 cursor-pointer">
                {task.error}
              </div>
            </Tooltip>
          );
        }

        if (task.status === 'STOPPED') {
          return <span className="text-slate-400 text-xs">Task stopped</span>;
        }

        return <span className="text-slate-500 text-xs">Waiting for its turn</span>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 170,
      align: 'right',
      render: (_, task) => (
        <div className="flex items-center justify-end gap-1.5">
          {/* Details button */}
          <Button size="small" type="text" onClick={() => setDetailModalTask(task)} className="text-xs text-slate-300 px-2">
            Details
          </Button>

          {task.status !== 'QUEUED' && task.status !== 'RUNNING' && onViewHistory && (
            <Tooltip title="View details in the History tab">
              <Button
                size="small"
                icon={<HistoryOutlined />}
                onClick={() => onViewHistory(task.targetUrl)}
                className="text-xs px-2 text-cyan-300 border-cyan-800/60 bg-cyan-950/40 hover:bg-cyan-900/50"
              >
                History
              </Button>
            </Tooltip>
          )}

          {task.status === 'QUEUED' && (
            <Tooltip title="Move to the top and run immediately">
              <Button
                size="small"
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={() => onRunNow(task.id)}
                className="text-xs px-2.5 bg-amber-600 hover:bg-amber-500 border-none font-semibold text-white shadow-sm flex items-center gap-1"
              >
                Run now
              </Button>
            </Tooltip>
          )}

          {(task.status === 'FAILED' || task.status === 'DEAD_LETTER' || task.status === 'STOPPED' || task.status === 'PARTIAL') && (
            <Tooltip title="Run this post again">
              <Button
                size="small"
                onClick={() => onRetry(task.id)}
                className="text-xs px-2.5 text-amber-300 border-amber-800/60 bg-amber-950/40 hover:bg-amber-900/50"
              >
                Retry
              </Button>
            </Tooltip>
          )}

          {(task.status === 'RUNNING' || task.status === 'QUEUED') && onStop && (
            <Tooltip title={task.stopRequested ? 'Waiting to stop after the current turn' : 'Stop just this post'}>
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                loading={Boolean(task.stopRequested)}
                disabled={Boolean(task.stopRequested)}
                onClick={() => onStop(task.id)}
                className="text-xs px-2.5"
              >
                {task.stopRequested ? 'Stopping...' : 'Stop'}
              </Button>
            </Tooltip>
          )}

          <Tooltip title="Remove from queue">
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
              <h2 className="text-base sm:text-lg font-semibold text-slate-100 m-0">Auto queue</h2>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                  isEmergencyStopped ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isEmergencyStopped ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                {isEmergencyStopped ? 'Paused' : 'Active'}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/25">
                ⚡ Multi-process: {maxParallelTasks} posts in parallel
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 mb-0 max-w-2xl">
              The system runs up to {maxParallelTasks} posts at once on independent Vias, split evenly across {scannedPages.length || totalAvailablePages} Pages.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {completedItems.length > 0 && (
              <Button type="text" onClick={onClearCompleted} className="text-slate-400 hover:text-slate-200">
                Clear finished ({completedItems.length})
              </Button>
            )}
            {queueItems.length > 0 && onClearAll && (
              <Button type="text" danger onClick={onClearAll} className="hover:bg-rose-950/40">
                Delete all ({queueItems.length})
              </Button>
            )}
            <Button onClick={onRefresh} icon={<ReloadOutlined />}>
              Refresh
            </Button>
            {isEmergencyStopped && onResume && (
              <Button onClick={onResume} className="border-emerald-500 text-emerald-400">Resume</Button>
            )}
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => setIsQuickAddModalOpen(true)}
              className="font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 border-none shadow-sm flex items-center gap-1.5"
            >
              ⚡ Quick add to queue
            </Button>
            {onCreateNew && (
              <Button
                icon={<PlusOutlined />}
                onClick={onCreateNew}
                className="text-slate-300 border-slate-700 hover:border-slate-500 text-xs"
              >
                Full settings
              </Button>
            )}
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
                Running
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
              <span className="text-xs font-normal text-slate-400">posts running</span>
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
                Waiting
              </span>
            </div>
            <div className="text-2xl font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
              <span>{queuedItems.length}</span>
              <span className="text-xs font-normal text-slate-400">posts in queue</span>
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
                Completed
              </span>
            </div>
            <div className="text-2xl font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
              <span>{completedItems.length}</span>
              <span className="text-xs font-normal text-slate-400">posts done</span>
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
                Failed
              </span>
            </div>
            <div className="text-2xl font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
              <span>{failedItems.length}</span>
              <span className="text-xs font-normal text-slate-400">need review</span>
            </div>
          </div>
        </Col>
      </Row>

      {/* 3. "🔥 LIVE BUFFING" section */}
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
                  Live Buffing Progress ({runningItems.length} posts)
                </span>
              </div>
              <span className="text-xs font-mono text-cyan-300">Auto-updates every 3s</span>
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
                        Details
                      </Button>
                      <div className="text-xs font-mono text-cyan-300 font-bold shrink-0 text-right tabular-nums">
                        <div>{done} / {total} Page ({pct}%)</div>
                        {(() => {
                          const t = getRunTiming(task, now);
                          return t ? (
                            <div className="font-normal text-slate-400">
                              {formatDuration(t.elapsed)}
                              {t.remaining !== null && ` · ~${formatDuration(t.remaining)} left`}
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

      {/* 4. Posts in the queue */}
      <Card
        className="app-surface rounded-2xl border border-slate-800/80 shadow-lg p-0 overflow-hidden"
        title={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-100">
                Posts
              </span>
              <Badge
                count={filteredItems.length}
                overflowCount={999}
                style={{ backgroundColor: '#0284c7' }}
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Input
                placeholder="Search post links..."
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
        {/* Filter tabs */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/40">
          <Segmented
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as FilterStatus)}
            options={[
              { label: `All (${queueItems.length})`, value: 'ALL' },
              { label: `Running (${runningItems.length})`, value: 'RUNNING' },
              { label: `Waiting (${queuedItems.length})`, value: 'QUEUED' },
              { label: `Completed (${completedItems.length})`, value: 'COMPLETED' },
              { label: `Failed (${failedItems.length})`, value: 'FAILED' },
            ]}
            className="bg-slate-950 border border-slate-800 text-xs"
          />
        </div>

        {/* Data table */}
        <Table
          dataSource={filteredItems}
          columns={columns}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total) => `${total} posts in total`,
          }}
          scroll={{ x: 920 }}
          className="ant-table-dark-custom"
          locale={{
            emptyText: (
              <div className="py-16 text-center text-slate-400 text-xs space-y-3">
                <FieldTimeOutlined className="text-3xl text-slate-600 block mb-1" />
                <div className="font-semibold text-slate-300 text-sm">The queue is empty</div>
                <p className="max-w-md mx-auto text-slate-500">
                  No posts in the queue yet. You can quick-add posts right here!
                </p>
                <div>
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={() => setIsQuickAddModalOpen(true)}
                    className="font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 border-none shadow-sm text-xs"
                  >
                    ⚡ Quick-add posts to the queue
                  </Button>
                </div>
              </div>
            ),
          }}
        />
      </Card>

      {/* 6. POST DETAIL MODAL (EACH PAGE THAT HAS/IS BUFFING) */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-100">
            <UnorderedListOutlined className="text-cyan-400" />
            <span>Buff Run Details & Fanpage List</span>
          </div>
        }
        open={Boolean(detailModalTask)}
        onCancel={() => setDetailModalTask(null)}
        footer={[
          <Button key="close" onClick={() => setDetailModalTask(null)} className="text-xs">
            Close
          </Button>,
          detailModalTask?.status !== 'QUEUED' && detailModalTask?.status !== 'RUNNING' && onViewHistory && (
            <Button
              key="viewHistory"
              type="primary"
              icon={<HistoryOutlined />}
              onClick={() => {
                const url = detailModalTask.targetUrl;
                setDetailModalTask(null);
                onViewHistory(url);
              }}
              className="bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold"
            >
              View in History
            </Button>
          ),
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
              Run now
            </Button>
          ),
        ]}
        width={780}
        className="dark-modal"
      >
        {detailModalTask && (
          <div className="space-y-4 py-2 text-xs">
            {/* Post info */}
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300">Facebook Post Link:</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => handleCopyLink(detailModalTask.targetUrl)}
                    className="text-[11px]"
                  >
                    Copy
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<ExportOutlined />}
                    onClick={() => window.open(detailModalTask.targetUrl, '_blank')}
                    className="text-[11px] bg-blue-600"
                  >
                    Open post
                  </Button>
                </div>
              </div>
              <div className="font-mono text-cyan-400 break-all bg-slate-950 p-2 rounded border border-slate-800">
                {detailModalTask.targetUrl}
              </div>
            </div>

            {/* Technical specs */}
            <Row gutter={[12, 12]}>
              <Col xs={12} sm={6}>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Status</div>
                  <div className="mt-1 font-bold">
                    {detailModalTask.status === 'RUNNING' ? (
                      <Tag color="processing" icon={<LoadingOutlined spin />}>Buffing</Tag>
                    ) : detailModalTask.status === 'QUEUED' ? (
                      <Tag color="warning">Queued</Tag>
                    ) : detailModalTask.status === 'COMPLETED' ? (
                      <Tag color="success">Completed</Tag>
                    ) : (
                      <Tag color="error">Failed</Tag>
                    )}
                  </div>
                </div>
              </Col>

              <Col xs={12} sm={6}>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Reaction</div>
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
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Like Count</div>
                  <div className="mt-1 font-mono font-bold text-blue-400">
                    {detailModalTask.targetLikes === 'ALL' ? 'All Pages' : `${detailModalTask.targetLikes || 30} Pages`}
                  </div>
                </div>
              </Col>

              <Col xs={12} sm={6}>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Scheduled</div>
                  <div className="mt-1 font-mono text-amber-400 font-semibold truncate">
                    {detailModalTask.runAfter ? new Date(detailModalTask.runAfter).toLocaleTimeString() : '—'}
                  </div>
                </div>
              </Col>
            </Row>

            {/* Success progress */}
            {detailModalTask.result && (
              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between">
                <div>
                  <span className="font-bold text-emerald-300">Result:</span>
                  <span className="text-slate-300 ml-2">
                    Success <strong>{detailModalTask.result.success}</strong> / {detailModalTask.result.total} Pages
                    (Failed: {detailModalTask.result.failed})
                  </span>
                </div>
                {detailModalTask.result.durationSec && (
                  <span className="font-mono text-slate-400">
                    Duration: {formatDuration(detailModalTask.result.durationSec)}
                  </span>
                )}
              </div>
            )}

            {/* Per-Fanpage list of what was done */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">
                  Per-Fanpage Activity (
                  {detailModalTask.pageDetails?.length || 0} entries):
                </span>
                <span className="text-[11px] text-slate-400">Recorded in real time</span>
              </div>

              {detailModalTask.pageDetails && detailModalTask.pageDetails.length > 0 ? (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 text-[11px] uppercase border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="p-2">#</th>
                        <th className="p-2">Fanpage Con</th>
                        <th className="p-2">Reaction</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Time</th>
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
                                ✅ Success
                              </Tag>
                            ) : (
                              <Tag color="error" className="text-[10px] m-0 border-0">
                                ❌ {item.error || 'Error'}
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
                    ? 'The post is in the queue. When it runs, each Fanpage that likes it will show up here live.'
                    : 'No detailed log for this post yet.'}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 7. QUICK-ADD POSTS TO QUEUE MODAL */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 text-slate-100">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <ThunderboltOutlined className="text-base" />
            </div>
            <div>
              <div className="text-sm sm:text-base font-bold">Quick-Add Posts To The Queue</div>
              <div className="text-[11px] font-normal text-slate-400">
                Automatically schedules & assigns Fanpages to buff when its turn comes
              </div>
            </div>
          </div>
        }
        open={isQuickAddModalOpen}
        onCancel={() => !isSubmittingQuickAdd && setIsQuickAddModalOpen(false)}
        footer={[
          <Button
            key="cancel"
            onClick={() => setIsQuickAddModalOpen(false)}
            disabled={isSubmittingQuickAdd}
            className="text-xs"
          >
            Close
          </Button>,
          <Button
            key="submit"
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={isSubmittingQuickAdd}
            onClick={handleQuickAddSubmit}
            className="font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 border-none text-xs"
          >
            {isSubmittingQuickAdd ? 'Adding...' : '⚡ Add to Queue Now'}
          </Button>,
        ]}
        width={680}
        className="dark-modal"
      >
        <div className="space-y-4 py-2 text-xs">
          {/* Single post or multiple posts tab */}
          <Segmented
            block
            value={quickAddMode}
            onChange={(val) => setQuickAddMode(val as 'SINGLE' | 'BATCH')}
            options={[
              { label: '⚡ One post link', value: 'SINGLE' },
              { label: '📋 Add many links at once (Batch)', value: 'BATCH' },
            ]}
            className="bg-slate-950 border border-slate-800 text-xs p-1"
          />

          {/* Link input */}
          {quickAddMode === 'SINGLE' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  Facebook post link:
                </label>
                <Button
                  size="small"
                  type="text"
                  onClick={handlePasteQuickUrl}
                  className="text-cyan-400 hover:text-cyan-300 text-xs p-0 h-auto"
                >
                  📋 Paste from clipboard
                </Button>
              </div>
              <Input
                value={quickTargetUrl}
                onChange={(e) => setQuickTargetUrl(e.target.value)}
                placeholder="https://www.facebook.com/permalink.php?story_fbid=... or /reel/..."
                className="bg-slate-950 border-slate-700 text-slate-100 text-xs rounded-lg font-mono py-2"
                allowClear
                onPressEnter={handleQuickAddSubmit}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  Facebook links (1 per line):
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    type="text"
                    onClick={handlePasteQuickUrl}
                    className="text-cyan-400 hover:text-cyan-300 text-xs p-0 h-auto"
                  >
                    📋 Paste from clipboard
                  </Button>
                  <span className="text-[11px] text-cyan-400 font-mono">
                    {quickBatchUrls.split('\n').filter((l) => l.trim().startsWith('http')).length} valid links
                  </span>
                </div>
              </div>
              <TextArea
                rows={4}
                value={quickBatchUrls}
                onChange={(e) => setQuickBatchUrls(e.target.value)}
                placeholder="https://www.facebook.com/post1&#10;https://www.facebook.com/post2&#10;https://www.facebook.com/post3"
                className="bg-slate-950 border-slate-700 text-slate-100 text-xs rounded-lg font-mono"
              />
            </div>
          )}

          {/* Like target per post */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200">
                Like target per post:
              </label>
              <span className="text-xs font-bold text-amber-400 font-mono">
                {quickTargetLikes === 'ALL'
                  ? `All Pages (${scannedPages.length || totalAvailablePages} Pages)`
                  : `${quickTargetLikes} Like`}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { value: 30, label: '30 Likes', hint: 'Starter' },
                { value: 50, label: '50 Likes', hint: 'Popular' },
                { value: 100, label: '100 Likes', hint: 'Standard' },
                { value: 200, label: '200 Like', hint: 'KPI Cao' },
                { value: 'ALL', label: '👑 All Pages', hint: 'Entire fleet' },
              ].map((opt) => {
                const isSelected = quickTargetLikes === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setQuickTargetLikes(opt.value as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500 shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span className="text-[10px] opacity-60 ml-1.5">({opt.hint})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reaction */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-200">Reaction:</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { val: 'RANDOM_POSITIVE', label: '✨ Natural', desc: 'Like + Love + Care' },
                { val: 'LIKE', label: '👍 Like', desc: '100% blue Like' },
                { val: 'LOVE', label: '❤️ Love', desc: '100% red heart' },
                { val: 'CARE', label: '🥰 Care', desc: '100% Care' },
              ].map((item) => (
                <button
                  key={item.val}
                  type="button"
                  onClick={() => setQuickReaction(item.val)}
                  className={`p-2.5 rounded-lg text-left border transition-all cursor-pointer ${
                    quickReaction === item.val
                      ? 'bg-blue-500/20 text-blue-300 border-blue-500 shadow-sm'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className="text-xs font-bold">{item.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Schedule & speed */}
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12}>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200">
                  Start schedule:
                </label>
                <Select
                  value={quickDelayMinutes}
                  onChange={setQuickDelayMinutes}
                  className="w-full"
                  options={[
                    { label: '⚡ Run as soon as there is a slot (0 min)', value: 0 },
                    { label: '⏱️ Wait 5 minutes before starting', value: 5 },
                    { label: '⏱️ Wait 10 minutes before starting', value: 10 },
                    { label: '⏱️ Wait 15 minutes before starting', value: 15 },
                    { label: '⏱️ Wait 30 minutes before starting', value: 30 },
                  ]}
                />
              </div>
            </Col>

            <Col xs={24} sm={12}>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200">
                  Processing speed:
                </label>
                <Select
                  value={quickSpeedMode}
                  onChange={setQuickSpeedMode}
                  className="w-full"
                  options={[
                    { label: '🚀 FAST — High speed (2.0s)', value: 'FAST' },
                    { label: '⚖️ NORMAL — Fast & stable (Recommended)', value: 'NORMAL' },
                    { label: '🛡️ SMART — Adaptive (3.0s+)', value: 'SMART' },
                    { label: '🐢 SAFE — Conservative spacing (5.5s)', value: 'SAFE' },
                  ]}
                />
              </div>
            </Col>
          </Row>

          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
            <span className="text-amber-400 text-sm">💡</span>
            <span>
              Posts are queued and run automatically. The system auto-replaces any Page that is checkpointed or hidden.
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BuffQueueTab;
