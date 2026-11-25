import React, { useState } from 'react';
import { App } from 'antd';
import type { AutoBuffProgress, BatchOrder, BuffLogEntry } from '../types';
import { useVisibleInterval } from '../../../hooks/useVisibleInterval';
import { Button, Card, Input, Progress, Tag } from 'antd';
import { CheckCircleFilled, CheckCircleOutlined, CheckOutlined, ClockCircleOutlined, CodeOutlined, ExclamationCircleOutlined, ExportOutlined, HistoryOutlined, InfoCircleOutlined, LoadingOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, RocketOutlined, SearchOutlined, StopOutlined, ThunderboltFilled, ThunderboltOutlined } from '@ant-design/icons';
import { REACTIONS } from '../constants';
import { cleanPageName, formatDuration, getAvatarGradient, getInitials } from '../utils';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export interface RunningTabProps {
  autoBuffProgress: AutoBuffProgress;
  runTiming: { start: number | null; end: number | null };
  runningTargetInfo: {
    url: string;
    reaction: string;
    count: number;
    startedAt: number;
    actorMode?: 'VIAS' | 'FANPAGES';
    speedMode?: string;
    engagementMode?: string;
  } | null;
  liveLogs: string[];
  avatarCacheMap: Record<string, { pageId: string; name?: string; avatarUrl?: string; hasAvatar?: boolean }>;
  buffLogs: BuffLogEntry[];
  queueItems: any[];
  batchOrders: BatchOrder[];
  setBatchOrders: SetState<BatchOrder[]>;
  batchLinkConcurrency: number;
  isBatchRunning: boolean;
  isResumingRemaining: boolean;
  buffMode: 'SINGLE' | 'BATCH';
  setBuffMode: SetState<'SINGLE' | 'BATCH'>;
  delayMs: number;
  engagementMode: 'LIKE_AND_COMMENT' | 'LIKE_ONLY' | 'COMMENT_ONLY';
  selectedAccountId: number | 'CUSTOM' | 'ALL_VIAS';
  setSelectedAccountId: SetState<number | 'CUSTOM' | 'ALL_VIAS'>;
  selectedReaction: string;
  targetPostUrl: string;
  setActiveTabKey: (key: string) => void;
  setActorMode: SetState<'VIAS' | 'FANPAGES'>;
  setBatchLikesPerOrder: SetState<number>;
  setBatchLinksText: SetState<string>;
  handleOpenManagePages: (viaId?: number | 'CUSTOM' | 'ALL_VIAS') => void;
  handleRefillBatchIncomplete: () => void;
  handleRefillSingleOrder: (order: BatchOrder) => void;
  handleResumeRemaining: (customLog?: any) => void;
  handleStartNewCampaign: () => void | Promise<void>;
  handleStopAutoBuff: () => void;
  handleStopQueueTask: (id: string) => void;
}

/** "Live progress" tab: progress of the live / batch run, live log, clock.
 *  The 1-second clock lives in this tab so only this tab re-renders every second. */
export default function RunningTab({
  autoBuffProgress,
  runTiming,
  runningTargetInfo,
  liveLogs,
  avatarCacheMap,
  buffLogs,
  queueItems,
  batchOrders,
  setBatchOrders,
  batchLinkConcurrency,
  isBatchRunning,
  isResumingRemaining,
  buffMode,
  setBuffMode,
  delayMs,
  engagementMode,
  selectedAccountId,
  setSelectedAccountId,
  selectedReaction,
  targetPostUrl,
  setActiveTabKey,
  setActorMode,
  setBatchLikesPerOrder,
  setBatchLinksText,
  handleOpenManagePages,
  handleRefillBatchIncomplete,
  handleRefillSingleOrder,
  handleResumeRemaining,
  handleStartNewCampaign,
  handleStopAutoBuff,
  handleStopQueueTask,
}: RunningTabProps) {
  const { message } = App.useApp();
  // commentStatus 'SKIPPED' means NO comment → must not count as a commented turn
  const hasRealComment = (d: { commentStatus?: string; commentText?: string }) =>
    Boolean((d.commentStatus && d.commentStatus !== 'SKIPPED') || d.commentText);
  const [runningFilter, setRunningFilter] = useState<'ALL' | 'SUCCESS' | 'ALREADY_LIKED' | 'FAILED' | 'RUNNING' | 'WAITING'>('ALL');
  const [runningSearch, setRunningSearch] = useState<string>('');
  const [showLiveTerminal, setShowLiveTerminal] = useState<boolean>(true);
  const [expandedBatchOrderIds, setExpandedBatchOrderIds] = useState<Set<number>>(new Set());
  const [clockNow, setClockNow] = useState(() => Date.now());
  const clockTicking =
    autoBuffProgress.status === 'RUNNING' &&
    (autoBuffProgress.details.length === 0 ||
      autoBuffProgress.details.some((d) => d.status === 'WAITING' || d.status === 'RUNNING'));
  useVisibleInterval(() => setClockNow(Date.now()), clockTicking ? 1000 : null);

  const isBatch = (buffMode === 'BATCH' || batchOrders.length > 0) && batchOrders.length > 0;
  const totalBatchLikesTarget = batchOrders.reduce((sum, o) => sum + (o.totalLikesTarget || 0), 0);
  const totalBatchSuccess = batchOrders.reduce((sum, o) => sum + (o.successLikes || 0), 0);
  const totalBatchAlreadyLiked = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'ALREADY_LIKED').length || 0), 0);
  const totalBatchFailed = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'FAILED' || d.status === 'ERROR').length || 0), 0);

  return (
              <div className="space-y-4">
                {/* Header bar */}
                <div className="app-surface p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2 m-0">
                        <PlayCircleOutlined className="text-blue-400" /> Live engagement progress
                      </h2>
                      {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                        <Tag color="processing" className="text-xs font-bold px-2.5 py-0.5 rounded-full border-blue-500/40">
                          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block mr-1.5"></span>
                          Running live (Form)
                        </Tag>
                      ) : queueItems.some((i) => i.status === 'RUNNING') ? (
                        <Tag color="cyan" className="text-xs font-bold px-2.5 py-0.5 rounded-full border-cyan-500/40 bg-cyan-950/60 text-cyan-300">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse inline-block mr-1.5"></span>
                          Queue processing ({queueItems.filter((i) => i.status === 'RUNNING').length} posts)
                        </Tag>
                      ) : autoBuffProgress.status === 'DONE' ? (
                        <Tag color="success" className="text-xs font-bold px-2.5 py-0.5 rounded-full">
                          <CheckCircleFilled className="mr-1" /> Completed
                        </Tag>
                      ) : (
                        <Tag className="text-xs font-medium px-2.5 py-0.5 rounded-full text-slate-400 bg-slate-800/60 border-slate-700/60">
                          No run yet
                        </Tag>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 mb-0">
                      {autoBuffProgress.status === 'RUNNING' || isBatchRunning
                        ? 'The system is driving Playwright to drop reactions and comments in real time.'
                        : queueItems.some((i) => i.status === 'RUNNING')
                        ? 'The auto queue is running tasks with Playwright in real time.'
                        : autoBuffProgress.status === 'DONE'
                        ? 'The campaign just finished all its engagements.'
                        : 'No campaign is running. Go to the New tab to start one.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={handleStartNewCampaign}
                      className="font-semibold rounded-xl text-xs sm:text-sm h-9 bg-blue-600 hover:bg-blue-500"
                    >
                      New campaign
                    </Button>
                    {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length > 0 && (
                      <Button
                        icon={<ClockCircleOutlined />}
                        onClick={() => setActiveTabKey('buff-queue')}
                        className="rounded-xl text-xs sm:text-sm h-9"
                      >
                        Queue ({queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length})
                      </Button>
                    )}
                    {autoBuffProgress.status === 'RUNNING' && (
                      <Button
                        danger
                        type="primary"
                        icon={<StopOutlined />}
                        onClick={handleStopAutoBuff}
                        className="font-semibold rounded-xl text-xs sm:text-sm h-9"
                      >
                        Emergency stop
                      </Button>
                    )}
                  </div>
                </div>

                {/* Empty State when IDLE or Active Queue Worker View */}
                {autoBuffProgress.status === 'IDLE' && !isBatchRunning && batchOrders.length === 0 ? (
                  queueItems.some((i) => i.status === 'RUNNING') ? (
                    <div className="space-y-4">
                      {queueItems
                        .filter((i) => i.status === 'RUNNING')
                        .map((task, idx) => {
                          const done = task.progress?.done || 0;
                          const isKpiMode = typeof task.targetLikes === 'number' && task.targetLikes > 0;
                          const targetKpi = isKpiMode ? task.targetLikes : (task.progress?.total || 1);
                          const total = task.progress?.total || targetKpi;
                          const successCount = task.progress?.success ?? (task.pageDetails?.filter((p: any) => p.status === 'SUCCESS' || p.status === 'ALREADY_LIKED').length || 0);
                          const failedCount = task.progress?.failed ?? (task.pageDetails?.filter((p: any) => p.status === 'FAILED' || p.status === 'ERROR').length || 0);
                          const remainingNeeded = isKpiMode ? Math.max(0, targetKpi - successCount) : Math.max(0, total - done);
                          const pct = isKpiMode
                            ? Math.min(100, Math.max(0, Math.round((successCount / Math.max(1, targetKpi)) * 100)))
                            : Math.min(100, Math.max(0, Math.round((done / Math.max(1, total)) * 100)));
                          const rObj = REACTIONS.find((r) => r.key === task.reactionType) || REACTIONS[0];
                          const timing = (() => {
                            const started = task.startedAt ? new Date(task.startedAt).getTime() : 0;
                            if (!started) return null;
                            const elapsed = Math.max(0, (Date.now() - started) / 1000);
                            const remaining = done > 0 && remainingNeeded > 0 ? (elapsed / Math.max(1, isKpiMode ? successCount : done)) * remainingNeeded : null;
                            return { elapsed, remaining };
                          })();

                          return (
                            <div key={task.id || idx} className="app-surface p-5 rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/20 to-slate-900/60 space-y-4 shadow-xl">
                              {/* Header Card */}
                              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                                <div className="space-y-1.5 min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Tag color="cyan" className="font-bold text-xs px-2.5 py-0.5 rounded-full border-cyan-500/40">
                                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse inline-block mr-1.5 align-middle" />
                                      Auto queue (Worker {idx + 1})
                                    </Tag>
                                    <Tag className="font-semibold text-xs rounded-full">
                                      {rObj.emoji} {rObj.shortLabel}
                                    </Tag>
                                    {task.viaName && (
                                      <Tag color="blue" className="text-xs rounded-full">
                                        Via: {task.viaName}
                                      </Tag>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 pt-1">
                                    <span className="text-xs text-slate-400 shrink-0">Post link:</span>
                                    <a
                                      href={task.targetUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-mono text-sm text-cyan-300 hover:text-cyan-200 truncate underline max-w-xl"
                                    >
                                      {task.targetUrl}
                                    </a>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                  <Button
                                    size="small"
                                    danger
                                    icon={<StopOutlined />}
                                    loading={Boolean(task.stopRequested)}
                                    disabled={Boolean(task.stopRequested)}
                                    onClick={() => handleStopQueueTask(task.id)}
                                    className="rounded-xl text-xs font-semibold"
                                  >
                                    {task.stopRequested ? 'Stopping...' : 'Stop'}
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={() => setActiveTabKey('buff-queue')}
                                    className="rounded-xl text-xs"
                                  >
                                    View queue
                                  </Button>
                                  <Button
                                    size="small"
                                    type="primary"
                                    ghost
                                    icon={<ExportOutlined />}
                                    onClick={() => window.open(task.targetUrl, '_blank')}
                                    className="rounded-xl text-xs"
                                  >
                                    Open Facebook
                                  </Button>
                                </div>
                              </div>

                              {/* Metrics */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center">
                                  <div className="text-[11px] text-slate-400 font-bold uppercase">{isKpiMode ? 'KPI target' : 'Target'}</div>
                                  <div className="text-xl font-bold text-slate-100 mt-0.5">{targetKpi} {isKpiMode ? 'Like' : 'Page'}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-center">
                                  <div className="text-[11px] text-emerald-400 font-bold uppercase">Success</div>
                                  <div className="text-xl font-bold text-emerald-300 mt-0.5">{successCount}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-center">
                                  <div className="text-[11px] text-rose-400 font-bold uppercase">{isKpiMode ? 'Errors (auto-replaced)' : 'Errors / Skipped'}</div>
                                  <div className="text-xl font-bold text-rose-300 mt-0.5">{failedCount}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-center">
                                  <div className="text-[11px] text-blue-400 font-bold uppercase">{isKpiMode ? 'Still needed' : 'Pending'}</div>
                                  <div className="text-xl font-bold text-blue-300 mt-0.5">{remainingNeeded}</div>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                                <div className="flex items-center justify-between text-xs flex-wrap gap-1">
                                  <span className="text-slate-300 font-semibold">
                                    Progress: <b className="text-cyan-400">{isKpiMode ? successCount : done}</b> / {targetKpi} {isKpiMode ? 'successful likes' : 'Fanpages'} ({pct}%)
                                    {isKpiMode && failedCount > 0 && (
                                      <span className="text-slate-400 font-normal ml-2 text-[11px]">
                                        (Went through {done} Fanpages · Auto-replaced {failedCount} failures)
                                      </span>
                                    )}
                                  </span>
                                  {timing && (
                                    <span className="text-slate-400 font-mono text-[11px]">
                                      Running for {formatDuration(timing.elapsed)}
                                      {timing.remaining !== null && ` · ~${formatDuration(timing.remaining)} left`}
                                    </span>
                                  )}
                                </div>
                                <Progress
                                  percent={pct}
                                  status="active"
                                  strokeColor={{ '0%': '#06b6d4', '100%': '#3b82f6' }}
                                  showInfo={false}
                                  className="m-0"
                                />
                              </div>

                              {/* Recent Fanpage Activities (Last 10) */}
                              {task.pageDetails && task.pageDetails.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                                    <span>Recently engaged Fanpages ({task.pageDetails.length} done):</span>
                                    <span className="text-[11px]">Auto-updates in real time</span>
                                  </div>
                                  <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 divide-y divide-slate-800/60">
                                    {[...task.pageDetails].reverse().slice(0, 10).map((p: any, pIdx: number) => (
                                      <div key={pIdx} className="px-3 py-2 flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2 truncate">
                                          <span className="text-slate-500 font-mono text-[11px]">#{task.pageDetails.length - pIdx}</span>
                                          <span className="font-semibold text-slate-200 truncate">{p.pageName || p.pageId || 'Fanpage'}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          {p.status === 'SUCCESS' ? (
                                            <Tag color="success" className="text-[10px] m-0 border-0">
                                              ✅ Success
                                            </Tag>
                                          ) : (
                                            <Tag color="error" className="text-[10px] m-0 border-0">
                                              ❌ {p.error || 'Error'}
                                            </Tag>
                                          )}
                                          <span className="text-[11px] font-mono text-slate-500">{p.time || 'just now'}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                      {/* Next queued tasks teaser */}
                      {queueItems.filter((i) => i.status === 'QUEUED').length > 0 && (
                        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs">
                          <span className="text-slate-300 flex items-center">
                            <ClockCircleOutlined className="text-amber-400 mr-1.5" />
                            <span><b>{queueItems.filter((i) => i.status === 'QUEUED').length}</b> more posts are waiting in the queue</span>
                          </span>
                          <Button size="small" type="link" onClick={() => setActiveTabKey('buff-queue')} className="text-cyan-400 p-0 text-xs">
                            Manage the whole queue →
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-6 max-w-2xl mx-auto">
                      {/* Most recently completed campaign card */}
                      {buffLogs && buffLogs.length > 0 && (
                        <div className="app-surface p-5 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/20 via-slate-900/60 to-slate-900/80 shadow-xl space-y-3.5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Tag color="success" className="font-bold text-xs px-2.5 py-0.5 rounded-full border-emerald-500/40">
                                <CheckCircleOutlined className="mr-1" />
                                Post just finished its run
                              </Tag>
                              <span className="text-xs text-slate-400">
                                {new Date(buffLogs[0].createdAt).toLocaleTimeString('vi-VN')}
                              </span>
                            </div>
                            <Button
                              size="small"
                              type="link"
                              icon={<HistoryOutlined />}
                              onClick={() => setActiveTabKey('buff-history')}
                              className="text-cyan-400 p-0 text-xs hover:text-cyan-300"
                            >
                              View all History ({buffLogs.length}) →
                            </Button>
                          </div>

                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                                <span>Post:</span>
                                <span className="font-semibold text-slate-200">
                                  {buffLogs[0].reactionType || 'LIKE'}
                                </span>
                              </div>
                              <a
                                href={buffLogs[0].targetUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-sm text-cyan-300 hover:text-cyan-200 truncate underline block max-w-md"
                              >
                                {buffLogs[0].targetUrl}
                              </a>
                            </div>

                            <div className="flex items-center gap-4 shrink-0">
                              <div className="text-right">
                                <div className="text-[11px] text-slate-400">Successful likes</div>
                                <div className="text-xl font-bold text-emerald-400">
                                  {buffLogs[0].successCount} <span className="text-xs font-normal text-slate-400">likes</span>
                                </div>
                              </div>

                              <Button
                                size="middle"
                                type="primary"
                                icon={<RocketOutlined />}
                                loading={isResumingRemaining}
                                onClick={() => handleResumeRemaining(buffLogs[0])}
                                className="font-semibold text-xs rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border-none shadow-md shadow-cyan-600/20"
                              >
                                Run more likes
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Empty State Banner */}
                      <div className="app-surface p-10 text-center space-y-4 rounded-2xl border border-dashed border-slate-800">
                        <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-2xl text-blue-400 shadow-lg shadow-blue-500/10">
                          <PlayCircleOutlined />
                        </div>
                        <div className="space-y-1.5">
                          <h3 className="text-base font-bold text-slate-100">Nothing is running right now</h3>
                          <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
                            When you click <b>Start</b> on the New tab, or when posts in the Queue get their turn, the real-time progress of every Fanpage/Via shows up here in detail.
                          </p>
                        </div>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                          <Button
                            type="primary"
                            size="large"
                            icon={<PlusOutlined />}
                            onClick={() => setActiveTabKey('buff-like')}
                            className="font-semibold rounded-xl text-xs sm:text-sm"
                          >
                            Create a campaign now
                          </Button>
                          {queueItems.filter((i) => i.status === 'QUEUED').length > 0 && (
                            <Button
                              size="large"
                              icon={<ClockCircleOutlined />}
                              onClick={() => setActiveTabKey('buff-queue')}
                              className="font-semibold rounded-xl text-amber-300 border-amber-500/40 bg-amber-950/30 text-xs sm:text-sm"
                            >
                              View queue ({queueItems.filter((i) => i.status === 'QUEUED').length} waiting)
                            </Button>
                          )}
                          {buffLogs.length > 0 && (
                            <Button
                              size="large"
                              icon={<HistoryOutlined />}
                              onClick={() => setActiveTabKey('buff-history')}
                              className="font-semibold rounded-xl text-xs sm:text-sm"
                            >
                              View history ({buffLogs.length})
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-4">
                    {/* Post Meta & Timing Banner */}
                    <div className="app-surface p-4 sm:p-5 space-y-4">
                      {/* Header banner: distinguishes BATCH vs SINGLE mode */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                        <div className="min-w-0 flex-1">
                          {buffMode === 'BATCH' && batchOrders.length > 0 ? (
                            <div>
                              <div className="text-xs text-slate-400 font-medium flex items-center gap-2">
                                <span>Multi-post engagement campaign (Batch Mode):</span>
                                <Tag color="cyan" className="m-0 text-[10px] font-bold border-0 px-2 py-0.5 rounded-full">
                                  {batchLinkConcurrency === 2 ? '2 posts in parallel' : '1 post at a time'}
                                </Tag>
                              </div>
                              {(() => {
                                const completedCount = batchOrders.filter((o) => o.status === 'COMPLETED').length;
                                const partialCount = batchOrders.filter((o) => o.status === 'PARTIAL').length;
                                const runningCount = batchOrders.filter((o) => o.status === 'RUNNING').length;
                                return (
                                  <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                                    <span className="text-sm sm:text-base font-bold text-slate-100">
                                      Completed <b className="text-emerald-400">{completedCount}</b> / {batchOrders.length} posts
                                      {partialCount > 0 && (
                                        <span className="text-amber-400 font-semibold ml-2 text-xs sm:text-sm">
                                          ({partialCount} posts need a like top-up)
                                        </span>
                                      )}
                                    </span>
                                    {runningCount > 0 && (
                                      <span className="text-[11px] text-cyan-300 font-semibold bg-cyan-950/70 border border-cyan-800/70 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                        {runningCount} posts running at once
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="text-xs text-slate-400 font-medium">Post being engaged:</div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-bold text-blue-300 truncate max-w-xl">
                                  {runningTargetInfo?.url || targetPostUrl || 'Facebook post'}
                                </span>
                                {(runningTargetInfo?.url || targetPostUrl) && (
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<ExportOutlined />}
                                    onClick={() => window.open(runningTargetInfo?.url || targetPostUrl, '_blank')}
                                    className="text-blue-400 hover:text-blue-300 text-xs shrink-0 p-1 h-auto"
                                    title="Open the link on Facebook"
                                  >
                                    Open Facebook
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Top-right info & ETA card (styled like the post template) */}
                        {(() => {
                          const isBatch = (buffMode === 'BATCH' || batchOrders.length > 0) && batchOrders.length > 0;
                          const batchTotal = isBatch
                            ? batchOrders.reduce((s, o) => s + (o.totalLikesTarget || 0), 0)
                            : autoBuffProgress.total;
                          const batchDone = isBatch
                            ? batchOrders.reduce((s, o) => s + (o.successLikes || 0), 0)
                            : autoBuffProgress.success;
                          const overallPercent =
                            isBatch && batchTotal > 0
                              ? Math.min(100, Math.round((batchDone / batchTotal) * 100))
                              : autoBuffProgress.percent;

                          const isAllBatchOrdersDone = isBatch && batchOrders.length > 0 && batchOrders.every((o) => o.status === 'COMPLETED' || o.status === 'PARTIAL' || o.status === 'FAILED' || o.status === 'PAUSED');
                          const waitingCount = autoBuffProgress.details.filter((d) => d.status === 'WAITING').length;
                          const runningCount = autoBuffProgress.details.filter((d) => d.status === 'RUNNING').length;
                          const isWaitingOrRunning = autoBuffProgress.details.length === 0 ? autoBuffProgress.status === 'RUNNING' : (waitingCount > 0 || runningCount > 0);
                          const isCooling = Boolean(autoBuffProgress.currentRunningPageName?.includes('🛡️'));
                          const isSingleRunning = (autoBuffProgress.status === 'RUNNING' && isWaitingOrRunning) || isCooling;
                          const isAnyRunning = isBatch ? (isBatchRunning && !isAllBatchOrdersDone) : isSingleRunning;
                          // "Done" only when the target was actually reached: a run that ran out of Pages also ends in status DONE,
                          // and used to show COMPLETED / Target reached at 78/100
                          const singleTargetTop = autoBuffProgress.total || autoBuffProgress.details.length;
                          const singleAchievedTop = (autoBuffProgress.success || 0) + (autoBuffProgress.alreadyLiked || 0);
                          const isDoneFull = isBatch
                            ? (isAllBatchOrdersDone && batchDone >= batchTotal)
                            : (singleTargetTop > 0 && singleAchievedTop >= singleTargetTop && (autoBuffProgress.status === 'DONE' || overallPercent >= 100));
                          const isExhausted = !isAnyRunning && !isDoneFull && (
                            isBatch
                              ? (isAllBatchOrdersDone && batchDone < batchTotal)
                              : (autoBuffProgress.details.length > 0 && !isWaitingOrRunning)
                          );

                          const elapsedSec = Math.max(0, Math.round(((runTiming.end || clockNow) - (runTiming.start || clockNow)) / 1000));
                          const avgSecPerNick = Math.max(8, Math.round(((delayMs || 6000) + 4000) / 1000));
                          const remainingItems = isBatch
                            ? Math.max(0, batchTotal - batchDone)
                            : Math.max(0, autoBuffProgress.details.length > 0 ? (waitingCount + runningCount) : Math.max(0, autoBuffProgress.total - (autoBuffProgress.success + autoBuffProgress.alreadyLiked)));
                          const estimatedRemainingSec = isAnyRunning ? remainingItems * avgSecPerNick : 0;
                          const totalEstimatedSec = Math.max(elapsedSec + estimatedRemainingSec, (isBatch ? batchTotal : (autoBuffProgress.total || 1)) * avgSecPerNick);

                          return (
                            <div className="flex flex-wrap items-center gap-3 shrink-0 text-xs">
                              {/* Reaction & target tags */}
                              <div className="flex flex-col gap-1.5">
                                <div className="px-3 py-1 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center gap-1.5">
                                  <span className="text-slate-400">
                                    {autoBuffProgress.details.some(hasRealComment) || runningTargetInfo?.engagementMode === 'COMMENT_ONLY' || engagementMode === 'COMMENT_ONLY'
                                      ? 'Mode:'
                                      : 'Reaction:'}
                                  </span>
                                  <span className="font-bold text-slate-100">
                                    {(() => {
                                      const isCmt =
                                        autoBuffProgress.details.some(hasRealComment) ||
                                        runningTargetInfo?.engagementMode === 'COMMENT_ONLY' ||
                                        engagementMode === 'COMMENT_ONLY';
                                      if (isCmt && engagementMode !== 'LIKE_AND_COMMENT') return 'Comments only';
                                      const rxKey = runningTargetInfo?.reaction || selectedReaction;
                                      const r = REACTIONS.find((x) => x.key === rxKey);
                                      return r ? `${r.emoji} ${r.label}` : rxKey;
                                    })()}
                                  </span>
                                </div>
                                <div className="px-3 py-1 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center gap-1.5">
                                  <span className="text-slate-400">Target:</span>
                                  <span className="font-bold text-slate-100 tabular-nums">
                                    {isBatch
                                      ? `${batchTotal} like (${batchOrders.length} link)`
                                      : `${autoBuffProgress.total || runningTargetInfo?.count || 0} nick`}
                                  </span>
                                </div>
                              </div>

                              {/* Time & progress card, matching mockup 2 */}
                              {runTiming.start && (
                                <div className="p-2.5 rounded-xl bg-slate-950/90 border border-cyan-500/40 shadow-lg shadow-cyan-950/40 min-w-[170px] space-y-1">
                                  <div className="flex items-center justify-between text-[11px] font-bold pb-0.5">
                                    {isAnyRunning ? (
                                      <span className="flex items-center gap-1.5 text-cyan-300">
                                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                                        RUNNING
                                      </span>
                                    ) : isDoneFull ? (
                                      <span className="flex items-center gap-1.5 text-emerald-300">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                        COMPLETED
                                      </span>
                                    ) : autoBuffProgress.status === 'ERROR' ? (
                                      <span className="flex items-center gap-1.5 text-amber-300">
                                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                        INTERRUPTED
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1.5 text-amber-300">
                                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                        {isExhausted ? 'OUT OF ACCOUNTS' : 'STOPPED'}
                                      </span>
                                    )}
                                    <span className="text-slate-400 font-mono text-[10px]">~{totalEstimatedSec}s</span>
                                  </div>

                                  <div className="flex items-baseline justify-between py-0.5">
                                    <span className="text-lg font-mono font-extrabold text-white tabular-nums">
                                      {formatDuration(elapsedSec)}
                                    </span>
                                    <span className="text-xs font-mono font-extrabold text-cyan-300">
                                      {overallPercent}%
                                    </span>
                                  </div>

                                  <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        isDoneFull
                                          ? 'bg-emerald-400'
                                          : isAnyRunning
                                          ? 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                                          : 'bg-amber-400'
                                      }`}
                                      style={{ width: `${overallPercent}%` }}
                                    ></div>
                                  </div>

                                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-0.5">
                                    <span>{isAnyRunning ? `Estimate: ~${estimatedRemainingSec}s left` : (isDoneFull ? 'Target reached' : 'Finished')}</span>
                                    <button
                                      type="button"
                                      onClick={() => setShowLiveTerminal((prev) => !prev)}
                                      className="text-cyan-400 hover:text-cyan-300 text-[10px] flex items-center gap-0.5 cursor-pointer"
                                      title="View detailed log"
                                    >
                                      <CodeOutlined /> Log
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Glowing Live Progress Bar & Status Pill Badge */}
                      {(() => {
                        const isBatch = (buffMode === 'BATCH' || batchOrders.length > 0) && batchOrders.length > 0;
                        const batchTotal = isBatch
                          ? batchOrders.reduce((s, o) => s + (o.totalLikesTarget || 0), 0)
                          : autoBuffProgress.total;
                        const batchDone = isBatch
                          ? batchOrders.reduce((s, o) => s + (o.successLikes || 0), 0)
                          : autoBuffProgress.success;
                        const overallPercent =
                          isBatch && batchTotal > 0
                            ? Math.min(100, Math.round((batchDone / batchTotal) * 100))
                            : autoBuffProgress.percent;

                        const isAllBatchOrdersDone = isBatch && batchOrders.length > 0 && batchOrders.every((o) => o.status === 'COMPLETED' || o.status === 'PARTIAL' || o.status === 'FAILED' || o.status === 'PAUSED');
                        const waitingCount = autoBuffProgress.details.filter((d) => d.status === 'WAITING').length;
                        const runningCount = autoBuffProgress.details.filter((d) => d.status === 'RUNNING').length;
                        const isWaitingOrRunning = autoBuffProgress.details.length === 0 ? autoBuffProgress.status === 'RUNNING' : (waitingCount > 0 || runningCount > 0);
                        const isCooling = Boolean(autoBuffProgress.currentRunningPageName?.includes('🛡️'));
                        const isSingleRunning = (autoBuffProgress.status === 'RUNNING' && isWaitingOrRunning) || isCooling;
                        const isAnyRunning = isBatch ? (isBatchRunning && !isAllBatchOrdersDone) : isSingleRunning;
                        const singleTarget = autoBuffProgress.total || autoBuffProgress.details.length || 0;
                        const singleAchieved = (autoBuffProgress.success || 0) + (autoBuffProgress.alreadyLiked || 0);
                        const hasInterruptedItems = autoBuffProgress.details.some(
                          (d) => d.status === 'SKIPPED' && /kết nối stream gián đoạn|stream connection interrupted/.test(String(d.message || ''))
                        );
                        const isDoneFull = isBatch
                          ? (isAllBatchOrdersDone && batchDone >= batchTotal)
                          : (!hasInterruptedItems && singleTarget > 0 && singleAchieved >= singleTarget && (autoBuffProgress.status === 'DONE' || overallPercent >= 100));
                        const isExhausted = !isAnyRunning && !isDoneFull && autoBuffProgress.status !== 'ERROR' && !autoBuffProgress.isStopped && (
                          isBatch
                            ? (isAllBatchOrdersDone && batchDone < batchTotal)
                            : (autoBuffProgress.details.length > 0 && !isWaitingOrRunning)
                        );
                        const elapsedSec = Math.max(0, Math.round(((runTiming.end || clockNow) - (runTiming.start || clockNow)) / 1000));
                        const totalBatchLikesTarget = batchOrders.reduce((sum, o) => sum + (o.totalLikesTarget || 0), 0);
                        const totalBatchSuccess = batchOrders.reduce((sum, o) => sum + (o.successLikes || 0), 0);
                        const totalBatchAlreadyLiked = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'ALREADY_LIKED').length || 0), 0);
                        const totalBatchFailed = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'FAILED' || d.status === 'ERROR').length || 0), 0);
                        const currentSuccessCount = isBatch ? totalBatchSuccess : (autoBuffProgress.success || 0);
                        const speedLikesPerMin = elapsedSec >= 4 && currentSuccessCount > 0 ? Math.round((currentSuccessCount / elapsedSec) * 60) : 0;
                        const speedSecPerLike = currentSuccessCount > 0 && elapsedSec > 0 ? (elapsedSec / currentSuccessCount).toFixed(1) : '0';

                        return (
                          <div className="space-y-3">
                            {/* Cooldown alert, if any */}
                            {autoBuffProgress.currentRunningPageName?.includes('🛡️') && (
                              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs shadow-md animate-pulse">
                                <ThunderboltFilled className="text-amber-400 text-sm flex-shrink-0" />
                                <span className="font-semibold">{autoBuffProgress.currentRunningPageName}</span>
                              </div>
                            )}

                            {/* Status pill badge & detailed action (matching mockup 2) */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-start sm:items-center gap-2.5">
                                {/* Pill Badge */}
                                {isAnyRunning ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-500/50 text-cyan-300 text-xs font-bold shadow-sm shadow-cyan-950/50">
                                    <LoadingOutlined spin className="text-cyan-400" />
                                    <span>Engaging ({elapsedSec}s)</span>
                                  </div>
                                ) : isDoneFull ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 text-xs font-bold shadow-sm shadow-emerald-950/50">
                                    <CheckCircleFilled className="text-emerald-400" />
                                    <span>100% complete ({elapsedSec}s)</span>
                                  </div>
                                ) : autoBuffProgress.status === 'ERROR' ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/70 border border-amber-500/50 text-amber-300 text-xs font-bold shadow-sm shadow-amber-950/50">
                                    <ExclamationCircleOutlined className="text-amber-400" />
                                    <span>Interrupted ({elapsedSec}s)</span>
                                  </div>
                                ) : isExhausted ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/70 border border-amber-500/50 text-amber-300 text-xs font-bold shadow-sm shadow-amber-950/50">
                                    <CheckCircleOutlined className="text-amber-400" />
                                    <span className="whitespace-nowrap">Short {autoBuffProgress.success}/{autoBuffProgress.total || autoBuffProgress.details.length}</span>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-950/70 border border-rose-500/50 text-rose-300 text-xs font-bold">
                                    <StopOutlined className="text-rose-400" />
                                    <span>Run stopped ({elapsedSec}s)</span>
                                  </div>
                                )}

                                {/* Subtext describing what Playwright is doing */}
                                <div className="text-xs text-slate-300">
                                  {isBatch ? (
                                    isBatchRunning ? (
                                      <span>Batch progress: <b className="text-white font-bold">{batchDone}/{batchTotal} likes done</b></span>
                                    ) : isDoneFull ? (
                                      <span className="text-emerald-300 font-semibold">100% of the Batch target reached</span>
                                    ) : (
                                      <span>Batch status: <b className="text-white font-bold">Reached {batchDone}/{batchTotal} likes</b></span>
                                    )
                                  ) : isAnyRunning ? (
                                    <span>
                                      Playwright is processing: <b className="text-cyan-300 font-bold">{autoBuffProgress.currentRunningPageName || 'Opening the post & checking the like button...'}</b>
                                    </span>
                                  ) : isDoneFull ? (
                                    <span className="text-emerald-300 font-semibold flex items-center gap-1.5">
                                      <CheckCircleFilled className="text-emerald-400" /> KPI target reached: {autoBuffProgress.success} successful likes
                                    </span>
                                  ) : autoBuffProgress.status === 'ERROR' ? (
                                    <span className="text-amber-300 font-medium">
                                      The run was interrupted because the server restarted. {autoBuffProgress.success}/{autoBuffProgress.total} likes succeeded. Click "Finish the run" below to complete the remaining {autoBuffProgress.total - autoBuffProgress.success} likes!
                                    </span>
                                  ) : isExhausted ? (
                                    <span className="text-amber-300 font-medium flex items-center gap-1.5 flex-wrap">
                                      <span>
                                        {(() => {
                                          const isCmt =
                                            autoBuffProgress.details.some(hasRealComment) ||
                                            runningTargetInfo?.engagementMode === 'COMMENT_ONLY' ||
                                            engagementMode === 'COMMENT_ONLY';
                                          const unit = isCmt ? 'comments' : 'likes';
                                          return (
                                            <>
                                              Ran {autoBuffProgress.details.length} accounts in this round (<b className="text-emerald-300">{autoBuffProgress.success} successful {unit}</b>{autoBuffProgress.alreadyLiked > 0 ? `, ${autoBuffProgress.alreadyLiked} had engaged before` : ''}).
                                              {autoBuffProgress.total > autoBuffProgress.details.length && (
                                                <span className="text-slate-300 ml-1">
                                                  {Math.max(0, autoBuffProgress.total - autoBuffProgress.success - autoBuffProgress.alreadyLiked)} {unit} short because some Pages failed or were skipped. Click &quot;Finish the run&quot; to top up.
                                                </span>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenManagePages(selectedAccountId)}
                                        className="text-cyan-300 hover:text-cyan-200 underline font-bold cursor-pointer ml-1 inline-flex items-center gap-1"
                                      >
                                        <PlusOutlined className="text-[10px]" /> Add more Vias / Pages right here
                                      </button>
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 font-medium">
                                      {autoBuffProgress.currentRunningPageName || 'The run was stopped safely.'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {currentSuccessCount > 0 && speedLikesPerMin > 0 && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 font-mono text-xs font-bold shrink-0">
                                    <ThunderboltOutlined className="text-amber-400" />
                                    <span>{speedLikesPerMin} likes/min</span>
                                    <span className="text-slate-500">•</span>
                                    <span className="text-slate-300">~{speedSecPerLike}s/turn</span>
                                  </span>
                                )}
                                <span className="font-mono text-base font-extrabold text-cyan-300 shrink-0">
                                  {overallPercent}%
                                </span>
                              </div>
                            </div>

                            <Progress
                              percent={overallPercent}
                              status={isAnyRunning ? 'active' : undefined}
                              strokeColor={{ '0%': '#06b6d4', '100%': '#10b981' }}
                              size={['100%', 10]}
                              showInfo={false}
                            />
                          </div>
                        );
                      })()}

                      {/* 4 KPI Metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                        <div className="p-3.5 rounded-xl border bg-slate-950/80 border-slate-800 text-center">
                          <div className="text-xs text-slate-400 font-medium">
                            {isBatch ? 'Total target likes' : 'Total accounts'}
                          </div>
                          <div className="text-2xl font-extrabold text-slate-100 tabular-nums mt-1">
                            {isBatch ? `${totalBatchLikesTarget}` : (autoBuffProgress.total || 0)}
                          </div>
                          {isBatch && (
                            <div className="text-[10px] text-slate-400 mt-0.5 font-medium">{batchOrders.length} posts</div>
                          )}
                        </div>
                        <div className="p-3.5 rounded-xl border bg-emerald-950/40 border-emerald-800/50 text-center">
                          <div className="text-xs text-emerald-400 font-medium">Success</div>
                          <div className="text-2xl font-extrabold text-emerald-300 tabular-nums mt-1">
                            {isBatch ? totalBatchSuccess : (autoBuffProgress.success || 0)}
                          </div>
                          {isBatch && totalBatchLikesTarget > 0 && (
                            <div className="text-[10px] text-emerald-400 mt-0.5 font-medium">
                              Reached {Math.min(100, Math.round((totalBatchSuccess / Math.max(1, totalBatchLikesTarget)) * 100))}%
                              {totalBatchSuccess > totalBatchLikesTarget && ' (Over KPI)'}
                            </div>
                          )}
                        </div>
                        <div className="p-3.5 rounded-xl border bg-blue-950/40 border-blue-800/50 text-center">
                          <div className="text-xs text-blue-400 font-medium">Already liked</div>
                          <div className="text-2xl font-extrabold text-blue-300 tabular-nums mt-1">
                            {isBatch ? totalBatchAlreadyLiked : (autoBuffProgress.alreadyLiked || 0)}
                          </div>
                        </div>
                        <div className={`p-3.5 rounded-xl border text-center ${
                          isBatch && totalBatchLikesTarget > totalBatchSuccess
                            ? 'bg-amber-950/40 border-amber-800/50'
                            : 'bg-rose-950/40 border-rose-800/50'
                        }`}>
                          <div className={`text-xs font-medium ${
                            isBatch && totalBatchLikesTarget > totalBatchSuccess ? 'text-amber-400' : 'text-rose-400'
                          }`}>
                            {isBatch && totalBatchLikesTarget > totalBatchSuccess ? 'Short / Needs top-up' : 'Errors / Skipped'}
                          </div>
                          <div className={`text-2xl font-extrabold tabular-nums mt-1 ${
                            isBatch && totalBatchLikesTarget > totalBatchSuccess ? 'text-amber-300' : 'text-rose-300'
                          }`}>
                            {isBatch && totalBatchLikesTarget > totalBatchSuccess
                              ? totalBatchLikesTarget - totalBatchSuccess
                              : (isBatch ? totalBatchFailed : (autoBuffProgress.failed || 0))}
                          </div>
                          {isBatch && totalBatchLikesTarget > totalBatchSuccess && (
                            <div className="text-[10px] text-amber-400 mt-0.5 font-medium">
                              {totalBatchLikesTarget - totalBatchSuccess} likes short
                            </div>
                          )}
                        </div>
                      </div>

                      {/* If DONE, ERROR or STOPPED: Action & Summary Box (Only show when NOT RUNNING) */}
                      {autoBuffProgress.status !== 'RUNNING' && !isBatchRunning && (autoBuffProgress.status === 'DONE' || autoBuffProgress.status === 'ERROR' || autoBuffProgress.status === 'STOPPED' || (isBatch ? (totalBatchSuccess > 0 || batchOrders.some((o) => o.status === 'COMPLETED' || o.status === 'PARTIAL')) : (autoBuffProgress.details.length > 0 && (autoBuffProgress.total || 0) > 0))) && (() => {
                        const success = isBatch ? totalBatchSuccess : (autoBuffProgress.success || 0);
                        const total = isBatch ? totalBatchLikesTarget : (autoBuffProgress.total || 0);
                        const failed = isBatch ? totalBatchFailed : (autoBuffProgress.failed || 0);
                        const isExhaustedBox = isBatch ? (totalBatchSuccess < totalBatchLikesTarget) : (autoBuffProgress.details.length > 0 && success + failed < total && total > 0);
                        const isCmt =
                          autoBuffProgress.details.some(hasRealComment) ||
                          runningTargetInfo?.engagementMode === 'COMMENT_ONLY' ||
                          engagementMode === 'COMMENT_ONLY';
                        const unitName = isCmt ? 'comment' : 'like';
                        const isError = autoBuffProgress.status === 'ERROR';
                        const isStopped = Boolean(autoBuffProgress.isStopped || autoBuffProgress.status === 'STOPPED' || isExhaustedBox);
                        const isHighFailure = failed > success || failed >= 5 || isError;
                        const missingLikes = Math.max(0, total - success);

                        if (isHighFailure || isStopped || isError || isExhaustedBox || success < total) {
                          const bannerTitle = isError
                            ? 'Campaign interrupted by a connection issue'
                            : isBatch
                            ? (success < total ? `Batch campaign partially complete (${success}/${total} likes - ${Math.round((success / Math.max(1, total)) * 100)}%)` : 'Batch campaign complete')
                            : isExhaustedBox
                            ? 'The campaign used every available account in this round'
                            : isStopped
                            ? 'The campaign was stopped / ended early'
                            : success < total
                            ? `Campaign complete (${success}/${total} ${unitName}s)`
                            : 'Campaign complete with error warnings';
                          return (
                            <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl text-amber-400 shrink-0">
                                  {isError ? <ExclamationCircleOutlined /> : success < total ? <InfoCircleOutlined /> : <PauseCircleOutlined />}
                                </div>
                                <div>
                                  <div className="text-sm font-bold text-amber-300">
                                    {bannerTitle}
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    Successful {unitName}s: <span className="text-emerald-400 font-semibold">{success}</span>/{total}
                                    {missingLikes > 0 && !isExhaustedBox && <> • Short: <span className="text-amber-400 font-bold">{missingLikes} {unitName}s</span></>}
                                    {failed > 0 && <> • Errors/skipped: <span className="text-rose-400 font-semibold">{failed}</span></>}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  type="primary"
                                  icon={<PlusOutlined />}
                                  onClick={handleStartNewCampaign}
                                  className="font-bold text-xs rounded-xl bg-blue-600 hover:bg-blue-500 border-none shadow-md shadow-blue-600/30 text-white cursor-pointer"
                                >
                                  New campaign
                                </Button>
                                {isBatch && (
                                  <Button
                                    type="primary"
                                    icon={<RocketOutlined />}
                                    onClick={() => {
                                      const urls = batchOrders.map((o) => o.url).join('\n');
                                      setBuffMode('BATCH');
                                      if (urls) setBatchLinksText(urls);
                                      setBatchLikesPerOrder(100);
                                      setActorMode('FANPAGES');
                                      setSelectedAccountId('ALL_VIAS');
                                      setBatchOrders([]);
                                      setActiveTabKey('buff-like');
                                      message.success('Preloaded 5 posts with 100 Likes from the Fanpage pool! Click "Start run" to begin.');
                                    }}
                                    className="font-bold text-xs rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-none shadow-md shadow-emerald-600/20"
                                  >
                                    Re-run 5 posts with 100 Likes (Fanpages)
                                  </Button>
                                )}
                                {isBatch && (
                                  <Button
                                    onClick={() => {
                                      setBatchOrders([]);
                                      setActiveTabKey('buff-like');
                                    }}
                                    className="font-semibold text-xs rounded-xl text-slate-300 border-slate-700 hover:bg-slate-800"
                                  >
                                    New / Clear
                                  </Button>
                                )}
                                {isBatch && missingLikes > 0 && (
                                  <Button
                                    type="primary"
                                    icon={<ThunderboltOutlined />}
                                    onClick={handleRefillBatchIncomplete}
                                    className="font-semibold text-xs rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 border-none shadow-md shadow-amber-600/20"
                                  >
                                    Top up likes for short posts ({missingLikes} likes)
                                  </Button>
                                )}
                                {!isBatch && missingLikes > 0 && (runningTargetInfo?.url || targetPostUrl) && (
                                  <Button
                                    type="primary"
                                    icon={<RocketOutlined />}
                                    loading={isResumingRemaining}
                                    onClick={() => handleResumeRemaining({
                                      targetUrl: runningTargetInfo?.url || targetPostUrl,
                                      successCount: autoBuffProgress.success || 0,
                                      targetLikes: autoBuffProgress.total || 100,
                                      reactionType: runningTargetInfo?.reaction || selectedReaction || 'LIKE',
                                    })}
                                    className="font-semibold text-xs rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border-none shadow-md shadow-cyan-600/20"
                                  >
                                    Finish the run ({missingLikes} likes)
                                  </Button>
                                )}
                                <Button
                                  icon={<PlusOutlined />}
                                  onClick={() => handleOpenManagePages(selectedAccountId)}
                                  className="font-semibold text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                                >
                                  Add Vias / Pages
                                </Button>
                                {(runningTargetInfo?.url || targetPostUrl) && (
                                  <Button
                                    icon={<ExportOutlined />}
                                    onClick={() => window.open(runningTargetInfo?.url || targetPostUrl, '_blank')}
                                    className="font-semibold text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                                  >
                                    Check post
                                  </Button>
                                )}
                                <Button
                                  icon={<HistoryOutlined />}
                                  onClick={() => setActiveTabKey('buff-history')}
                                  className="text-xs rounded-xl"
                                >
                                  View History
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xl text-emerald-400 shrink-0">
                                🎉
                              </div>
                              <div>
                                <div className="text-sm font-bold text-emerald-300">Engagement campaign 100% complete!</div>
                                <div className="text-xs text-slate-400">
                                  Completed {success}/{total} likes. Data saved to History and a Telegram notification was sent.
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {(runningTargetInfo?.url || targetPostUrl) && (
                                <Button
                                  type="primary"
                                  icon={<ExportOutlined />}
                                  onClick={() => window.open(runningTargetInfo?.url || targetPostUrl, '_blank')}
                                  className="font-semibold text-xs rounded-xl"
                                >
                                  Check on Facebook
                                </Button>
                              )}
                              <Button
                                icon={<HistoryOutlined />}
                                onClick={() => setActiveTabKey('buff-history')}
                                className="text-xs rounded-xl"
                              >
                                View History
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Batch Orders View (if batch mode) */}
                    {buffMode === 'BATCH' && batchOrders.length > 0 && (
                      <div className="app-surface p-4 sm:p-5 space-y-3">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                          <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                            <span>Posts in the Batch ({batchOrders.length} posts)</span>
                            {batchLinkConcurrency === 2 && (
                              <Tag color="cyan" className="m-0 text-[10px] font-bold border-0 px-2 py-0.5 rounded-full">
                                ⚡ 2 posts in parallel
                              </Tag>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            Completed <b className="text-emerald-400">{batchOrders.filter((o) => o.status === 'COMPLETED').length}</b> / {batchOrders.length}
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          {batchOrders.map((order) => {
                            const isRunning = order.status === 'RUNNING';
                            const isExpanded = expandedBatchOrderIds.has(order.id);
                            const orderPercent =
                              order.percent ||
                              Math.round(((order.successLikes || 0) / Math.max(1, order.totalLikesTarget)) * 100);
                            return (
                              <div
                                key={order.id}
                                className={`p-3.5 rounded-xl border transition-all ${
                                  isRunning
                                    ? 'border-cyan-500/70 bg-gradient-to-r from-cyan-950/30 to-slate-950/80 shadow-md shadow-cyan-500/10'
                                    : order.status === 'COMPLETED'
                                    ? 'border-emerald-800/40 bg-slate-950/50'
                                    : order.status === 'FAILED'
                                    ? 'border-rose-800/40 bg-slate-950/50'
                                    : 'border-slate-800 bg-slate-950/40'
                                }`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-mono font-bold text-slate-200">
                                        #{order.orderNumber}
                                      </span>
                                      <a
                                        href={order.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-mono text-cyan-400 hover:underline truncate max-w-xs sm:max-w-md block"
                                        title={order.url}
                                      >
                                        {order.url.replace(/^https?:\/\/(www\.)?/, '')}
                                      </a>
                                      {isRunning && (
                                        <span className="flex items-center gap-1 text-[10px] px-2 py-0.2 rounded-full bg-cyan-900/60 text-cyan-300 border border-cyan-700/60 font-semibold animate-pulse shrink-0">
                                          Running
                                        </span>
                                      )}
                                    </div>
                                    {order.currentRunningPageName && isRunning && (
                                      <div className="text-[11px] text-cyan-300 mt-1 flex items-center gap-1.5">
                                        <LoadingOutlined spin className="text-cyan-400 text-xs" />
                                        <span>Working on: <b>{order.currentRunningPageName}</b></span>
                                      </div>
                                    )}
                                    {order.status === 'FAILED' && order.error && (
                                      <div className="text-[11px] text-rose-300 mt-1">{order.error}</div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-xs text-slate-300 font-mono font-semibold tabular-nums">
                                      {order.successLikes >= order.totalLikesTarget
                                        ? `${order.totalLikesTarget}/${order.totalLikesTarget} like`
                                        : `${order.successLikes}/${order.totalLikesTarget} like`}
                                      {order.successLikes > order.totalLikesTarget && (
                                        <span className="text-emerald-400 font-normal ml-1 text-[10px]">
                                          (+{order.successLikes - order.totalLikesTarget} like)
                                        </span>
                                      )}
                                    </span>
                                    {order.status === 'COMPLETED' ? (
                                      <Tag color="success" className="text-xs font-semibold m-0">
                                        100% complete
                                      </Tag>
                                    ) : order.status === 'PARTIAL' ? (
                                      <Tag color="warning" className="text-xs font-semibold m-0">
                                        Reached {order.successLikes}/{order.totalLikesTarget} ({order.totalLikesTarget - order.successLikes} short)
                                      </Tag>
                                    ) : isRunning ? (
                                      <Tag color="processing" className="text-xs font-semibold m-0">
                                        Running ({orderPercent}%)
                                      </Tag>
                                    ) : order.status === 'FAILED' ? (
                                      <Tag color="error" className="text-xs font-semibold m-0">
                                        Failed
                                      </Tag>
                                    ) : order.status === 'PAUSED' ? (
                                      <Tag color="warning" className="text-xs font-semibold m-0">
                                        Paused
                                      </Tag>
                                    ) : (
                                      <Tag color="default" className="text-xs font-semibold m-0">
                                        Waiting for its turn
                                      </Tag>
                                    )}

                                    {order.successLikes < order.totalLikesTarget && (order.status === 'PARTIAL' || order.status === 'COMPLETED') && (
                                      <Button
                                        size="small"
                                        type="primary"
                                        icon={<ThunderboltOutlined />}
                                        onClick={() => handleRefillSingleOrder(order)}
                                        className="bg-amber-600 hover:bg-amber-500 border-none text-[11px] font-bold h-6 px-2 shrink-0 shadow-sm"
                                      >
                                        Top up {order.totalLikesTarget - order.successLikes} likes
                                      </Button>
                                    )}
                                    {order.details && order.details.length > 0 && (
                                      <Button
                                        type="text"
                                        size="small"
                                        onClick={() => {
                                          setExpandedBatchOrderIds((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(order.id)) next.delete(order.id);
                                            else next.add(order.id);
                                            return next;
                                          });
                                        }}
                                        className="text-[11px] text-slate-400 hover:text-cyan-300 p-1 h-auto"
                                      >
                                        {isExpanded ? 'Hide details' : 'Show details'}
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* Mini Progress bar */}
                                <Progress
                                  percent={orderPercent}
                                  size={['100%', 4]}
                                  showInfo={false}
                                  strokeColor={{ '0%': '#06b6d4', '100%': '#10b981' }}
                                  trailColor="#1e293b"
                                  className="m-0 mt-2"
                                />

                                {/* Expanded list of pages for this order */}
                                {isExpanded && order.details && (
                                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    <div className="text-[11px] font-semibold text-slate-400 mb-1">
                                      Pages/Vias involved in this post ({order.details.length} accounts):
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                      {order.details.map((d, dIdx) => (
                                        <div
                                          key={d.pageId + dIdx}
                                          className={`px-2 py-1.5 rounded-lg border text-[11px] flex items-center justify-between gap-1.5 ${
                                            d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED'
                                              ? 'border-emerald-800/40 bg-emerald-950/20 text-emerald-300'
                                              : d.status === 'RUNNING'
                                              ? 'border-cyan-600/60 bg-cyan-950/40 text-cyan-200'
                                              : d.status === 'ERROR' || d.status === 'FAILED'
                                              ? 'border-rose-800/40 bg-rose-950/20 text-rose-300'
                                              : 'border-slate-800/60 bg-slate-900/40 text-slate-400'
                                          }`}
                                        >
                                          <div className="truncate">
                                            <span className="font-semibold">{cleanPageName(d.pageName)}</span>
                                            {d.viaName && <span className="text-[9px] text-slate-500 ml-1">({d.viaName})</span>}
                                          </div>
                                          <span className="shrink-0 font-medium">
                                            {d.status === 'SUCCESS'
                                              ? 'Success'
                                              : d.status === 'ALREADY_LIKED'
                                              ? 'Liked'
                                              : d.status === 'RUNNING'
                                              ? 'Liking...'
                                              : d.status === 'ERROR' || d.status === 'FAILED'
                                              ? 'Error'
                                              : 'Waiting'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Detailed Live Accounts Execution Feed */}
                    <div className="app-surface p-4 sm:p-5 space-y-4">
                      {/* Filter & Search Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[
                            { key: 'ALL', label: 'All', count: autoBuffProgress.details.length },
                            { key: 'RUNNING', label: 'Running', count: autoBuffProgress.details.filter((d) => d.status === 'RUNNING').length },
                            { key: 'SUCCESS', label: 'Success', count: autoBuffProgress.details.filter((d) => d.status === 'SUCCESS').length },
                            { key: 'ALREADY_LIKED', label: 'Already liked', count: autoBuffProgress.details.filter((d) => d.status === 'ALREADY_LIKED').length },
                            { key: 'FAILED', label: 'Errors', count: autoBuffProgress.details.filter((d) => d.status === 'ERROR' || d.status === 'NO_BUTTON' || d.status === 'FAILED').length },
                            { key: 'WAITING', label: 'Waiting', count: autoBuffProgress.details.filter((d) => d.status === 'WAITING').length },
                          ].map((f) => (
                            <button
                              key={f.key}
                              type="button"
                              onClick={() => setRunningFilter(f.key as any)}
                              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                runningFilter === f.key
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                              }`}
                            >
                              {f.label} ({f.count})
                            </button>
                          ))}
                        </div>

                        <div className="w-full sm:w-56">
                          <Input
                            placeholder="Search accounts..."
                            prefix={<SearchOutlined className="text-slate-500" />}
                            size="small"
                            value={runningSearch}
                            onChange={(e) => setRunningSearch(e.target.value)}
                            allowClear
                            className="rounded-lg"
                          />
                        </div>
                      </div>

                      {/* Live Execution Console (Terminal) */}
                      <div className="rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden shadow-sm">
                        <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800/90 bg-slate-900/60">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block"></span>
                              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block"></span>
                              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-slate-200 ml-1.5 flex items-center gap-1.5">
                              <CodeOutlined className="text-blue-400" /> Live Execution Log
                              {autoBuffProgress.status === 'RUNNING' && (
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-slate-400">
                              {liveLogs.length} events
                            </span>
                            <Button
                              type="text"
                              size="small"
                              onClick={() => setShowLiveTerminal((prev) => !prev)}
                              className="text-[11px] text-slate-400 hover:text-slate-200 h-6 px-2"
                            >
                              {showLiveTerminal ? 'Collapse ▲' : 'Expand ▼'}
                            </Button>
                          </div>
                        </div>

                        {showLiveTerminal && (
                          <div className="p-3 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1 bg-black/60 select-text">
                            {liveLogs.length === 0 ? (
                              <div className="text-slate-500 italic py-2">
                                {autoBuffProgress.status === 'RUNNING'
                                  ? '🚀 Starting the Playwright browser and connecting accounts...'
                                  : 'Ready to log once the run starts.'}
                              </div>
                            ) : (
                              liveLogs.map((log, idx) => {
                                const isSuccess = log.includes('✅') || log.includes('🎯');
                                const isError = log.includes('❌') || log.includes('⚠️');
                                const isCooldown = log.includes('🛡️');
                                const isStart = log.includes('🚀') || log.includes('⚡');
                                return (
                                  <div
                                    key={idx}
                                    className={`leading-relaxed tracking-tight ${
                                      isSuccess
                                        ? 'text-emerald-400'
                                        : isError
                                        ? 'text-rose-400 font-semibold'
                                        : isCooldown
                                        ? 'text-amber-300'
                                        : isStart
                                        ? 'text-blue-300'
                                        : 'text-slate-300'
                                    }`}
                                  >
                                    {log}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>

                      {/* Live Items Grid */}
                      {(() => {
                        const filtered = autoBuffProgress.details.filter((d) => {
                          if (runningFilter === 'RUNNING' && d.status !== 'RUNNING') return false;
                          if (runningFilter === 'SUCCESS' && d.status !== 'SUCCESS') return false;
                          if (runningFilter === 'ALREADY_LIKED' && d.status !== 'ALREADY_LIKED') return false;
                          if (runningFilter === 'FAILED' && (d.status !== 'ERROR' && d.status !== 'NO_BUTTON' && d.status !== 'FAILED')) return false;
                          if (runningFilter === 'WAITING' && d.status !== 'WAITING') return false;
                          if (runningSearch.trim()) {
                            const q = runningSearch.trim().toLowerCase();
                            return (
                              (d.pageName || '').toLowerCase().includes(q) ||
                              Boolean(d.viaName && d.viaName.toLowerCase().includes(q))
                            );
                          }
                          return true;
                        });

                        if (filtered.length === 0) {
                          return (
                            <div className="py-8 text-center text-xs text-slate-500">
                              No accounts match the filter.
                            </div>
                          );
                        }

                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[500px] overflow-y-auto pr-1">
                            {filtered.map((detail, index) => {
                              const rxKey = runningTargetInfo?.reaction || selectedReaction;
                              const reactionObj =
                                REACTIONS.find((r) => r.key === rxKey) ||
                                REACTIONS[0];
                              const isRunning = detail.status === 'RUNNING';
                              const isSuccess = detail.status === 'SUCCESS';
                              const isAlreadyLiked = detail.status === 'ALREADY_LIKED';
                              const isWaiting = detail.status === 'WAITING';
                              const cleanDetailName = cleanPageName(detail.pageName);
                              const detailAvatar =
                                avatarCacheMap[detail.pageId]?.avatarUrl ||
                                (detail.pageId ? `https://graph.facebook.com/${detail.pageId}/picture?type=square` : '');

                              return (
                                <div
                                  key={detail.pageId + index}
                                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                                    isRunning
                                      ? 'border-blue-500 bg-blue-950/40 shadow-sm shadow-blue-500/20'
                                      : isSuccess
                                      ? 'border-emerald-800/40 bg-emerald-950/20'
                                      : isAlreadyLiked
                                      ? 'border-blue-800/40 bg-blue-950/20'
                                      : isWaiting || detail.status === 'SKIPPED'
                                      ? 'border-slate-800/80 bg-slate-950/30 opacity-70'
                                      : 'border-rose-800/40 bg-rose-950/20'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div className="relative w-8 h-8 shrink-0 rounded-lg overflow-hidden bg-slate-800 border border-slate-700/60 shadow-sm flex items-center justify-center">
                                      {detailAvatar ? (
                                        <img
                                          src={detailAvatar}
                                          alt={cleanDetailName}
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.target as HTMLElement).style.display = 'none';
                                            const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                                            if (fallback) fallback.classList.remove('hidden');
                                          }}
                                        />
                                      ) : null}
                                      <div
                                        className={`w-full h-full text-on-accent font-semibold text-xs items-center justify-center ${getAvatarGradient(
                                          cleanDetailName
                                        )} ${detailAvatar ? 'hidden' : 'flex'}`}
                                      >
                                        {getInitials(cleanDetailName)}
                                      </div>
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-xs text-slate-100 truncate" title={cleanDetailName}>
                                          {cleanDetailName}
                                        </span>
                                        {engagementMode !== 'COMMENT_ONLY' && (
                                          <span className="text-xs shrink-0">{reactionObj.emoji}</span>
                                        )}
                                      </div>
                                      {detail.viaName && (
                                        <div className="text-[10px] text-slate-400 truncate">
                                          Via: {detail.viaName}
                                        </div>
                                      )}
                                      {detail.commentText && (
                                        <div className="text-[10px] text-blue-300 italic truncate max-w-[280px]">
                                          "{detail.commentText}"
                                        </div>
                                      )}
                                      {detail.error && (
                                        <div className="text-[10px] text-rose-300 truncate max-w-[280px]">
                                          {detail.error}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="shrink-0 flex items-center justify-end max-w-[140px]">
                                    {isWaiting && (
                                      <span className="text-[10px] text-slate-400 font-medium px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                                        Waiting
                                      </span>
                                    )}
                                    {isRunning && (
                                      <Tag color="processing" icon={<LoadingOutlined spin />} className="font-bold text-[10px] m-0">
                                        Liking...
                                      </Tag>
                                    )}
                                    {isSuccess && (
                                      <Tag
                                        color="success"
                                        icon={<CheckCircleFilled />}
                                        className="text-[10px] m-0 font-semibold max-w-[130px] truncate"
                                        title={detail.message || 'Success'}
                                      >
                                        {detail.commentStatus === 'SUCCESS' || detail.message?.includes('cmt') || detail.message?.includes('bình luận') || /comment/i.test(detail.message || '')
                                          ? 'Commented'
                                          : detail.message?.includes('like') || detail.message?.includes('Like')
                                          ? 'Liked'
                                          : 'Success'}
                                      </Tag>
                                    )}
                                    {isAlreadyLiked && (
                                      <Tag color="blue" icon={<CheckOutlined />} className="text-[10px] m-0">
                                        Already liked
                                      </Tag>
                                    )}
                                    {(detail.status === 'ERROR' || detail.status === 'FAILED') && (
                                      <Tag
                                        color="error"
                                        className="text-[10px] m-0 font-medium max-w-[130px] truncate"
                                        title={detail.error || detail.message || 'Error'}
                                      >
                                        {detail.error || detail.message || 'Error'}
                                      </Tag>
                                    )}
                                    {detail.status === 'NO_BUTTON' && (
                                      <Tag color="error" className="text-[10px] m-0">
                                        Like button not found
                                      </Tag>
                                    )}
                                    {detail.status === 'SKIPPED' && (
                                      <Tag className="text-[10px] m-0 max-w-[130px] truncate" title={detail.message || 'Skipped'}>
                                        {detail.message || 'Skipped'}
                                      </Tag>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
  );
}
