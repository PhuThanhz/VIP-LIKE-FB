import { useMemo, useState } from 'react';
import axios from 'axios';
import { App, Badge, Button, Dropdown, Empty, Input, Modal, Progress, Segmented, Space, Switch, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  ExportOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  SendOutlined,
} from '@ant-design/icons';
import MonitorPostsPanel from './MonitorPostsPanel';

export interface HunterMonitor {
  id: string;
  targetName: string;
  targetUrl: string;
  targetType: 'PAGE' | 'GROUP' | 'PROFILE';
  checkIntervalMinutes: number;
  expiresAt?: string | null;
  dailyPostsCount?: number;
  dailyStatsDate?: string | null;
  buffConfig: {
    targetLikes: number | 'ALL';
    variancePercent?: number;
    maxPostsPerDay?: number;
    enableDripFeed?: boolean;
    dripDurationMinutes?: number;
    reactionType: string;
    enableComment: boolean;
    delayMinutes: number;
    viaMode: string;
  };
  status: 'ACTIVE' | 'PAUSED';
  totalDetected: number;
  lastCheckedAt: string | null;
  lastFoundPostUrl: string | null;
  baselineDone?: boolean;
  lastPostsFound?: number;
  lastScanVia?: string | null;
  postLogCount?: number;
  skippedLimitCount?: number;
}

interface PostHunterTabProps {
  workerBaseUrl: string;
  monitors: HunterMonitor[];
  queueItems: any[];
  postHunterPaused?: boolean;
  onTogglePostHunterPaused?: (paused: boolean) => Promise<void> | void;
  autoBuffOwnPosts: boolean;
  maxPagesPerPost: number;
  onRefresh: () => void;
  onAdd: (prefillUrl?: string) => void;
  onEdit: (monitor: HunterMonitor) => void;
  onToggle: (id: string) => Promise<void> | void;
  onDelete: (id: string) => void;
  onScanNow: (id: string) => Promise<void>;
  onQueueUrl: (url: string) => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
}

type MonitorFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'ATTENTION';

const REACTION_LABELS: Record<string, string> = {
  RANDOM_POSITIVE: 'Like / Love / Care',
  LIKE: 'Like',
  LOVE: 'Love',
  CARE: 'Care',
};

const TYPE_LABELS: Record<string, string> = {
  PAGE: 'Fanpage',
  GROUP: 'Group',
  PROFILE: 'Profile',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return 'Not scanned';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function nextScanAt(mon: HunterMonitor): number {
  const intervalMs = Math.max(1, mon.checkIntervalMinutes || 10) * 60000;
  return mon.lastCheckedAt ? new Date(mon.lastCheckedAt).getTime() + intervalMs : 0;
}

function formatUntil(ts: number, now: number): string {
  const diff = ts - now;
  if (diff <= 60000) return 'Scanning soon';
  return `in ${Math.ceil(diff / 60000)} min`;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, 'facebook.com/').replace(/\/$/, '');
}

function isHunterTask(task: any): boolean {
  const source = String(task?.source || '');
  return source.startsWith('POST_HUNTER') || source === 'AUTO_OWN_POST';
}

// Operating status of 1 monitor (priority: paused → baselining → no posts seen → normal)
function getMonitorHealth(mon: HunterMonitor): { status: 'default' | 'processing' | 'warning' | 'success'; text: string; hint?: string } {
  if (mon.status !== 'ACTIVE') return { status: 'default', text: 'Paused' };
  if (!mon.baselineDone) {
    return mon.lastCheckedAt
      ? { status: 'warning', text: 'No baseline yet', hint: 'The last scan found no posts. Check the link, or whether the via is a member of the Group.' }
      : { status: 'processing', text: 'Baselining', hint: 'The first scan only records existing posts and does not buff old ones.' };
  }
  if (mon.lastCheckedAt && (mon.lastPostsFound ?? 1) === 0) {
    return { status: 'warning', text: 'No posts seen', hint: 'The last scan could not read any posts. The via may have lost access or been logged out.' };
  }
  return { status: 'success', text: 'Monitoring' };
}

function renderTaskStatus(task: any) {
  if (task.status === 'RUNNING') {
    const p = task.progress;
    return <Badge status="processing" text={p?.total ? `Buffing ${p.done}/${p.total}` : 'Buffing'} />;
  }
  if (task.status === 'COMPLETED') return <Badge status="success" text="Completed" />;
  if (task.status === 'FAILED') return <Badge status="error" text="Failed" />;
  if (task.status === 'CANCELLED' || task.status === 'STOPPED') return <Badge status="default" text="Cancelled" />;
  if (task.status === 'NEEDS_REVIEW') return <Badge status="warning" text="Needs review" />;
  if (task.status === 'PARTIAL') return <Badge status="warning" text="Partially done" />;
  return <Badge status="warning" text="Waiting to buff" />;
}

export default function PostHunterTab({
  workerBaseUrl,
  monitors,
  queueItems,
  postHunterPaused = false,
  onTogglePostHunterPaused,
  autoBuffOwnPosts,
  maxPagesPerPost,
  onRefresh,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  onScanNow,
  onQueueUrl,
  onOpenQueue,
  onOpenSettings,
}: PostHunterTabProps) {
  const { message } = App.useApp();
  const [filter, setFilter] = useState<MonitorFilter>('ALL');
  const [search, setSearch] = useState('');
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [togglingGlobalPause, setTogglingGlobalPause] = useState(false);

  const [testOpen, setTestOpen] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ posts: any[]; scanVia?: string | null } | null>(null);

  const now = Date.now();

  const stats = useMemo(() => {
    const active = monitors.filter((m) => m.status === 'ACTIVE');
    const hunterTasks = queueItems.filter(isHunterTask);
    const caught24h = hunterTasks.filter((t) => t.addedAt && now - new Date(t.addedAt).getTime() < DAY_MS).length;
    const waiting = hunterTasks.filter((t) => t.status === 'QUEUED').length;
    const running = queueItems.filter((t) => t.status === 'RUNNING').length;
    const nextScans = active.map(nextScanAt);
    const soonest = nextScans.length ? Math.min(...nextScans) : null;
    const attention = monitors.filter((m) => getMonitorHealth(m).status === 'warning').length;
    return { active: active.length, caught24h, waiting, running, soonest, attention };
  }, [monitors, queueItems, now]);

  const filteredMonitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return monitors.filter((m) => {
      if (filter === 'ACTIVE' && m.status !== 'ACTIVE') return false;
      if (filter === 'PAUSED' && m.status !== 'PAUSED') return false;
      if (filter === 'ATTENTION' && getMonitorHealth(m).status !== 'warning') return false;
      if (!q) return true;
      return m.targetName.toLowerCase().includes(q) || m.targetUrl.toLowerCase().includes(q);
    });
  }, [monitors, filter, search]);

  const recentCatches = useMemo(
    () =>
      queueItems
        .filter(isHunterTask)
        .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
        .slice(0, 8),
    [queueItems]
  );

  const handleScanNow = async (id: string) => {
    setScanningId(id);
    try {
      await onScanNow(id);
    } finally {
      setScanningId(null);
    }
  };

  const handleGlobalPauseSwitch = async (enabled: boolean) => {
    if (!onTogglePostHunterPaused) return;
    setTogglingGlobalPause(true);
    try {
      await onTogglePostHunterPaused(!enabled);
    } finally {
      setTogglingGlobalPause(false);
    }
  };

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    try {
      await onToggle(id);
    } finally {
      setTogglingId(null);
    }
  };

  const [sendingReport, setSendingReport] = useState(false);
  const handleSendDailyReport = async () => {
    try {
      setSendingReport(true);
      const res = await axios.post(`${workerBaseUrl}/api/buff-daily-report/send`);
      if (res.data?.success) {
        message.success('24h summary report sent to Telegram!');
      } else {
        message.error(res.data?.error || 'Could not send the report');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setSendingReport(false);
    }
  };

  const runTestScan = async () => {
    if (!testUrl.trim()) {
      message.warning('Paste the Fanpage or Group link to test-scan');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await axios.post(`${workerBaseUrl}/api/buff-hunter/test-scan`, { targetUrl: testUrl.trim() });
      if (res.data?.success) {
        setTestResult({ posts: res.data.posts || [], scanVia: res.data.scanVia });
      } else {
        message.error(res.data?.error || 'Test scan failed');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setTestLoading(false);
    }
  };

  const columns: ColumnsType<HunterMonitor> = [
    {
      title: 'Target',
      key: 'target',
      render: (_, mon) => {
        const daysLeft = mon.expiresAt ? Math.ceil((new Date(mon.expiresAt).getTime() - now) / DAY_MS) : null;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={mon.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-semibold text-slate-100 hover:text-blue-400 truncate"
                title={mon.targetUrl}
              >
                {mon.targetName}
              </a>
              {daysLeft !== null && (
                <span
                  className={`shrink-0 text-[10px] font-semibold px-1.5 py-px rounded-md ${
                    daysLeft > 5
                      ? 'bg-amber-400/10 text-amber-300'
                      : daysLeft > 0
                      ? 'bg-rose-400/10 text-rose-300'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {daysLeft > 0 ? `VIP ${daysLeft}d` : 'Expired'}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{TYPE_LABELS[mon.targetType] || 'Fanpage'}</div>
          </div>
        );
      },
    },
    {
      title: 'Buff plan',
      key: 'buff',
      width: 170,
      render: (_, mon) => {
        const cfg = mon.buffConfig || ({} as HunterMonitor['buffConfig']);
        const amount = cfg.targetLikes === 'ALL' ? `≤${maxPagesPerPost}` : `${cfg.targetLikes || 30}`;
        const detail = [
          REACTION_LABELS[cfg.reactionType] || cfg.reactionType,
          cfg.delayMinutes ? `wait ${cfg.delayMinutes}m` : null,
          cfg.enableComment ? 'comments' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Tooltip title={detail}>
            <div className="whitespace-nowrap">
              <span className="text-[13px] font-semibold text-slate-100">{amount}</span>
              <span className="text-[11px] text-slate-500 ml-1">likes / post</span>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: 'Today',
      key: 'today',
      width: 130,
      render: (_, mon) => {
        const max = mon.buffConfig?.maxPostsPerDay;
        const done = mon.dailyPostsCount || 0;
        if (!max) return <span className="text-xs text-slate-300">{done} posts</span>;
        return (
          <div className="pr-3">
            <div className="text-xs text-slate-300 whitespace-nowrap">
              {done}
              <span className="text-slate-500">/{max} posts</span>
            </div>
            <Progress percent={Math.min(100, (done / max) * 100)} showInfo={false} size="small" strokeColor="#22d3ee" className="!m-0" />
          </div>
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      width: 150,
      render: (_, mon) => {
        const health = getMonitorHealth(mon);
        const sub =
          mon.status === 'ACTIVE'
            ? `Next scan: ${formatUntil(nextScanAt(mon), now).toLowerCase()}`
            : mon.lastCheckedAt
            ? `Scanned ${formatAgo(mon.lastCheckedAt, now).toLowerCase()}`
            : '';
        const tip = [health.hint, mon.lastScanVia ? `Scanning via: ${mon.lastScanVia}` : null].filter(Boolean).join('\n');
        const body = (
          <div className="whitespace-nowrap">
            <Badge status={health.status} text={<span className="text-xs text-slate-200">{health.text}</span>} />
            {sub && <div className="text-[11px] text-slate-500 mt-0.5 pl-3.5">{sub}</div>}
          </div>
        );
        return tip ? <Tooltip title={<span className="whitespace-pre-line">{tip}</span>}>{body}</Tooltip> : body;
      },
    },
    {
      title: 'Caught',
      key: 'caught',
      width: 80,
      align: 'right',
      render: (_, mon) => (
        <div>
          {mon.lastFoundPostUrl ? (
          <Tooltip title="Open the latest post">
            <a href={mon.lastFoundPostUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-slate-100 hover:text-blue-400">
              {mon.totalDetected || 0}
            </a>
          </Tooltip>
          ) : (
            <span className="text-[13px] font-semibold text-slate-100">{mon.totalDetected || 0}</span>
          )}
          {(mon.skippedLimitCount || 0) > 0 && (
            <Tooltip title="New posts held back by the daily limit. They are retried after the daily reset.">
              <div className="text-[10px] text-amber-300 whitespace-nowrap">+{mon.skippedLimitCount} held</div>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      align: 'right',
      render: (_, mon) => (
        <Space size={4}>
          <Tooltip title={mon.status === 'ACTIVE' ? 'Pause' : 'Enable monitoring'}>
            <Switch size="small" checked={mon.status === 'ACTIVE'} loading={togglingId === mon.id} onChange={() => handleToggle(mon.id)} />
          </Tooltip>
          <Tooltip title="Scan now">
            <Button size="small" type="text" icon={<ThunderboltOutlined />} loading={scanningId === mon.id} onClick={() => handleScanNow(mon.id)} aria-label="Scan now" />
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <SettingOutlined />, label: 'Edit settings', onClick: () => onEdit(mon) },
                { key: 'open', icon: <ExportOutlined />, label: 'Open target page', onClick: () => window.open(mon.targetUrl, '_blank') },
                { type: 'divider' },
                { key: 'delete', icon: <DeleteOutlined />, label: 'Delete monitor', danger: true, onClick: () => onDelete(mon.id) },
              ],
            }}
          >
            <Button size="small" type="text" icon={<MoreOutlined />} aria-label="More actions" />
          </Dropdown>
        </Space>
      ),
    },
  ];

  const statItems = [
    { label: 'Monitoring', value: `${stats.active}/${monitors.length}`, warn: false },
    { label: 'New posts 24h', value: String(stats.caught24h), warn: false },
    { label: stats.running > 0 ? `Waiting · ${stats.running} running` : 'Waiting to buff', value: String(stats.waiting), warn: false },
    { label: 'Next scan', value: stats.soonest === null ? '—' : formatUntil(stats.soonest, now), warn: false },
    ...(stats.attention > 0 ? [{ label: 'Needs attention', value: String(stats.attention), warn: true }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Title + main actions */}
      <div className="app-surface p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-[15px] font-semibold text-slate-100">Auto-hunt new posts</span>
              <Badge
                status={postHunterPaused ? 'warning' : 'success'}
                text={
                  <span className={`text-xs ${postHunterPaused ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {postHunterPaused ? 'Paused' : 'Running'}
                  </span>
                }
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              New posts on a Page/Group get buffed automatically.{' '}
              <Tooltip title="The first scan only sets a baseline, so old posts aren't buffed. The via's Pages are rotated for even use.">
                <span className="underline decoration-dotted cursor-help">How it works</span>
              </Tooltip>
            </p>
          </div>
          <Space className="shrink-0" wrap size={8}>
            {onTogglePostHunterPaused && (
              <Tooltip title={postHunterPaused ? 'Enable Post Hunter' : 'Pause everything'}>
                <Switch checked={!postHunterPaused} loading={togglingGlobalPause} onChange={handleGlobalPauseSwitch} />
              </Tooltip>
            )}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'refresh', icon: <ReloadOutlined />, label: 'Refresh', onClick: onRefresh },
                  { key: 'test', icon: <SearchOutlined />, label: 'Test-scan a link', onClick: () => setTestOpen(true) },
                  { key: 'report', icon: <SendOutlined />, label: 'Send 24h report to Telegram', disabled: sendingReport, onClick: handleSendDailyReport },
                  { type: 'divider' },
                  {
                    key: 'own',
                    icon: <SettingOutlined />,
                    label: `Auto-buff posts made by the app: ${autoBuffOwnPosts ? 'On' : 'Off'}`,
                    onClick: onOpenSettings,
                  },
                ],
              }}
            >
              <Button icon={<MoreOutlined />} aria-label="More actions" />
            </Dropdown>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => onAdd()}>
              Add monitor
            </Button>
          </Space>
        </div>

        {/* Operating metrics */}
        <div className="flex flex-wrap gap-x-8 gap-y-3 pt-3 border-t border-slate-800/80">
          {statItems.map((item) => (
            <div key={item.label}>
              <div className={`text-xl font-semibold leading-none ${item.warn ? 'text-amber-300' : 'text-slate-100'}`}>{item.value}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">{item.label}</div>
            </div>
          ))}
        </div>

        {postHunterPaused && (
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            Paused: not scanning for new posts. Manual orders in the Queue still run.
          </div>
        )}
      </div>

      {/* Monitor list */}
      <div className="app-surface overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
          <Segmented<MonitorFilter>
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: `All ${monitors.length}` },
              { value: 'ACTIVE', label: `Running ${stats.active}` },
              { value: 'PAUSED', label: `Paused ${monitors.length - stats.active}` },
              ...(stats.attention > 0 ? [{ value: 'ATTENTION' as MonitorFilter, label: `Needs attention ${stats.attention}` }] : []),
            ]}
          />
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined className="text-slate-500" />}
            placeholder="Search monitors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="md:w-56"
          />
        </div>
        <Table<HunterMonitor>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={filteredMonitors}
          tableLayout="fixed"
          scroll={{ x: 860 }}
          expandable={{
            expandRowByClick: false,
            expandedRowRender: (mon) => <MonitorPostsPanel workerBaseUrl={workerBaseUrl} monitorId={mon.id} onQueueUrl={onQueueUrl} />,
          }}
          pagination={filteredMonitors.length > 10 ? { pageSize: 10, showTotal: (t) => `${t} monitors` } : false}
          locale={{
            emptyText:
              monitors.length === 0 ? (
                <div className="py-10">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span className="text-slate-400 text-xs">No monitors yet</span>}
                  >
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => onAdd()}>
                      Add monitor
                    </Button>
                  </Empty>
                </div>
              ) : (
                <div className="py-8 text-xs text-slate-400">No matching monitors</div>
              ),
          }}
        />
      </div>

      {/* Recently caught posts */}
      <div className="app-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80">
          <div className="text-[13px] font-semibold text-slate-100">Newly caught posts</div>
          <Button type="link" size="small" className="!p-0 text-xs" onClick={onOpenQueue}>
            View queue
          </Button>
        </div>
        {recentCatches.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">No posts yet.</div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {recentCatches.map((task) => {
              const monitorName =
                task.monitorName ||
                monitors.find((m) => m.id === task.monitorId)?.targetName ||
                (String(task.source || '').startsWith('POST_HUNTER:') ? String(task.source).slice('POST_HUNTER:'.length) : null);
              const source = task.source === 'AUTO_OWN_POST' ? 'Posted by the app' : monitorName;
              return (
                <div key={task.id} className="px-4 py-2.5 flex items-center gap-4 text-xs">
                  <div className="w-20 shrink-0 text-slate-500">{formatAgo(task.addedAt, now)}</div>
                  <div className="min-w-0 flex-1">
                    <a href={task.targetUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-slate-300 hover:text-blue-400">
                      {shortUrl(task.targetUrl || '')}
                    </a>
                    {source && <div className="text-[11px] text-slate-500 truncate">{source}</div>}
                  </div>
                  <div className="w-28 shrink-0">{renderTaskStatus(task)}</div>
                  <div className="w-14 shrink-0 text-right text-slate-400 font-mono">
                    {task.result ? `${task.result.success}/${task.result.total}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Test-scan a link */}
      <Modal
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        title="Test-scan a link"
        footer={null}
        width={720}
        className="dark-modal"
        destroyOnHidden
      >
        <p className="text-xs text-slate-400 mb-3">
          Reads the latest posts of a Fanpage or Group using a live via. Read-only, no engagement.
        </p>
        <div className="flex gap-2">
          <Input
            autoFocus
            allowClear
            placeholder="https://www.facebook.com/groups/... or a Fanpage link"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            onPressEnter={runTestScan}
          />
          <Button type="primary" loading={testLoading} onClick={runTestScan}>
            Test scan
          </Button>
        </div>

        {testLoading && <div className="text-xs text-slate-400 mt-3">Opening Facebook with a via, usually takes 15–40 seconds...</div>}

        {testResult && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>
                Found {testResult.posts.length} posts{testResult.scanVia ? ` · scanned with ${testResult.scanVia}` : ''}
              </span>
              {testResult.posts.length > 0 && (
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setTestOpen(false);
                    onAdd(testUrl.trim());
                  }}
                >
                  Monitor this link
                </Button>
              )}
            </div>
            {testResult.posts.length === 0 ? (
              <div className="text-xs text-amber-400 py-3">
                Could not read any posts. Check the link, or whether the via is a member of the Group.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/70 max-h-72 overflow-y-auto">
                {testResult.posts.map((p: any, idx: number) => (
                  <div key={p.url || idx} className="px-3 py-2 flex items-center gap-3 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-200 truncate">{(p.title || 'Facebook post').split('\n')[0]}</div>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[11px] text-blue-400 hover:underline">
                        {shortUrl(p.url)}
                      </a>
                    </div>
                    <div className="shrink-0 w-28">
                      {p.isAlreadyBuffed ? (
                        <Badge status="success" text={<span className="text-[11px] text-slate-300">Buffed</span>} />
                      ) : p.isInQueue ? (
                        <Badge status="warning" text={<span className="text-[11px] text-slate-300">In queue</span>} />
                      ) : (
                        <Badge status="default" text={<span className="text-[11px] text-slate-300">Not buffed</span>} />
                      )}
                    </div>
                    <Button
                      size="small"
                      onClick={() => {
                        setTestOpen(false);
                        onQueueUrl(p.url);
                      }}
                    >
                      Buff this post
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
