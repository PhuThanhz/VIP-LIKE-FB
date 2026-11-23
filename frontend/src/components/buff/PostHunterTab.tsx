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
  PROFILE: 'Trang cá nhân',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return 'Chưa quét';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function nextScanAt(mon: HunterMonitor): number {
  const intervalMs = Math.max(1, mon.checkIntervalMinutes || 10) * 60000;
  return mon.lastCheckedAt ? new Date(mon.lastCheckedAt).getTime() + intervalMs : 0;
}

function formatUntil(ts: number, now: number): string {
  const diff = ts - now;
  if (diff <= 60000) return 'Sắp quét';
  return `${Math.ceil(diff / 60000)} phút nữa`;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, 'facebook.com/').replace(/\/$/, '');
}

function isHunterTask(task: any): boolean {
  const source = String(task?.source || '');
  return source.startsWith('POST_HUNTER') || source === 'AUTO_OWN_POST';
}

// Trạng thái vận hành của 1 mục tiêu (ưu tiên thứ tự: tạm dừng → lấy mốc → không thấy bài → bình thường)
function getMonitorHealth(mon: HunterMonitor): { status: 'default' | 'processing' | 'warning' | 'success'; text: string; hint?: string } {
  if (mon.status !== 'ACTIVE') return { status: 'default', text: 'Tạm dừng' };
  if (!mon.baselineDone) {
    return mon.lastCheckedAt
      ? { status: 'warning', text: 'Chưa lấy được mốc', hint: 'Lần quét gần nhất không thấy bài nào. Kiểm tra link, hoặc via có phải thành viên Group không.' }
      : { status: 'processing', text: 'Đang lấy mốc', hint: 'Lần quét đầu chỉ ghi nhận bài hiện có, không buff bài cũ.' };
  }
  if (mon.lastCheckedAt && (mon.lastPostsFound ?? 1) === 0) {
    return { status: 'warning', text: 'Không thấy bài', hint: 'Lần quét gần nhất không đọc được bài nào. Via có thể đã mất quyền xem hoặc bị đăng xuất.' };
  }
  return { status: 'success', text: 'Đang theo dõi' };
}

function renderTaskStatus(task: any) {
  if (task.status === 'RUNNING') {
    const p = task.progress;
    return <Badge status="processing" text={p?.total ? `Đang buff ${p.done}/${p.total}` : 'Đang buff'} />;
  }
  if (task.status === 'COMPLETED') return <Badge status="success" text="Hoàn tất" />;
  if (task.status === 'FAILED') return <Badge status="error" text="Thất bại" />;
  if (task.status === 'CANCELLED' || task.status === 'STOPPED') return <Badge status="default" text="Đã hủy" />;
  if (task.status === 'NEEDS_REVIEW') return <Badge status="warning" text="Cần đối soát" />;
  if (task.status === 'PARTIAL') return <Badge status="warning" text="Xong một phần" />;
  return <Badge status="warning" text="Chờ buff" />;
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
        message.success('Đã gửi báo cáo tổng kết 24h về Telegram thành công!');
      } else {
        message.error(res.data?.error || 'Không thể gửi báo cáo');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setSendingReport(false);
    }
  };

  const runTestScan = async () => {
    if (!testUrl.trim()) {
      message.warning('Dán link Fanpage hoặc Group cần quét thử');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await axios.post(`${workerBaseUrl}/api/buff-hunter/test-scan`, { targetUrl: testUrl.trim() });
      if (res.data?.success) {
        setTestResult({ posts: res.data.posts || [], scanVia: res.data.scanVia });
      } else {
        message.error(res.data?.error || 'Quét thử thất bại');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setTestLoading(false);
    }
  };

  const columns: ColumnsType<HunterMonitor> = [
    {
      title: 'Mục tiêu',
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
                  {daysLeft > 0 ? `VIP ${daysLeft}d` : 'Hết hạn'}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{TYPE_LABELS[mon.targetType] || 'Fanpage'}</div>
          </div>
        );
      },
    },
    {
      title: 'Gói buff',
      key: 'buff',
      width: 170,
      render: (_, mon) => {
        const cfg = mon.buffConfig || ({} as HunterMonitor['buffConfig']);
        const amount = cfg.targetLikes === 'ALL' ? `≤${maxPagesPerPost}` : `${cfg.targetLikes || 30}`;
        const detail = [
          REACTION_LABELS[cfg.reactionType] || cfg.reactionType,
          cfg.delayMinutes ? `chờ ${cfg.delayMinutes}p` : null,
          cfg.enableComment ? 'bình luận' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Tooltip title={detail}>
            <div className="whitespace-nowrap">
              <span className="text-[13px] font-semibold text-slate-100">{amount}</span>
              <span className="text-[11px] text-slate-500 ml-1">like / bài</span>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: 'Hôm nay',
      key: 'today',
      width: 130,
      render: (_, mon) => {
        const max = mon.buffConfig?.maxPostsPerDay;
        const done = mon.dailyPostsCount || 0;
        if (!max) return <span className="text-xs text-slate-300">{done} bài</span>;
        return (
          <div className="pr-3">
            <div className="text-xs text-slate-300 whitespace-nowrap">
              {done}
              <span className="text-slate-500">/{max} bài</span>
            </div>
            <Progress percent={Math.min(100, (done / max) * 100)} showInfo={false} size="small" strokeColor="#22d3ee" className="!m-0" />
          </div>
        );
      },
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 150,
      render: (_, mon) => {
        const health = getMonitorHealth(mon);
        const sub =
          mon.status === 'ACTIVE'
            ? `Quét tiếp: ${formatUntil(nextScanAt(mon), now).toLowerCase()}`
            : mon.lastCheckedAt
            ? `Quét ${formatAgo(mon.lastCheckedAt, now).toLowerCase()}`
            : '';
        const tip = [health.hint, mon.lastScanVia ? `Via quét: ${mon.lastScanVia}` : null].filter(Boolean).join('\n');
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
      title: 'Đã bắt',
      key: 'caught',
      width: 80,
      align: 'right',
      render: (_, mon) =>
        mon.lastFoundPostUrl ? (
          <Tooltip title="Mở bài gần nhất">
            <a href={mon.lastFoundPostUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-slate-100 hover:text-blue-400">
              {mon.totalDetected || 0}
            </a>
          </Tooltip>
        ) : (
          <span className="text-[13px] font-semibold text-slate-100">{mon.totalDetected || 0}</span>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      align: 'right',
      render: (_, mon) => (
        <Space size={4}>
          <Tooltip title={mon.status === 'ACTIVE' ? 'Tạm dừng' : 'Bật theo dõi'}>
            <Switch size="small" checked={mon.status === 'ACTIVE'} loading={togglingId === mon.id} onChange={() => handleToggle(mon.id)} />
          </Tooltip>
          <Tooltip title="Quét ngay">
            <Button size="small" type="text" icon={<ThunderboltOutlined />} loading={scanningId === mon.id} onClick={() => handleScanNow(mon.id)} aria-label="Quét ngay" />
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <SettingOutlined />, label: 'Sửa cấu hình', onClick: () => onEdit(mon) },
                { key: 'open', icon: <ExportOutlined />, label: 'Mở trang mục tiêu', onClick: () => window.open(mon.targetUrl, '_blank') },
                { type: 'divider' },
                { key: 'delete', icon: <DeleteOutlined />, label: 'Xoá mục tiêu', danger: true, onClick: () => onDelete(mon.id) },
              ],
            }}
          >
            <Button size="small" type="text" icon={<MoreOutlined />} aria-label="Thao tác khác" />
          </Dropdown>
        </Space>
      ),
    },
  ];

  const statItems = [
    { label: 'Theo dõi', value: `${stats.active}/${monitors.length}`, warn: false },
    { label: 'Bài mới 24h', value: String(stats.caught24h), warn: false },
    { label: stats.running > 0 ? `Chờ buff · ${stats.running} đang chạy` : 'Chờ buff', value: String(stats.waiting), warn: false },
    { label: 'Quét tiếp', value: stats.soonest === null ? '—' : formatUntil(stats.soonest, now), warn: false },
    ...(stats.attention > 0 ? [{ label: 'Cần xem lại', value: String(stats.attention), warn: true }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Tiêu đề + thao tác chính */}
      <div className="app-surface p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-[15px] font-semibold text-slate-100">Tự săn bài mới</span>
              <Badge
                status={postHunterPaused ? 'warning' : 'success'}
                text={
                  <span className={`text-xs ${postHunterPaused ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {postHunterPaused ? 'Tạm dừng' : 'Đang chạy'}
                  </span>
                }
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Page/Group có bài mới là tự buff.{' '}
              <Tooltip title="Lần quét đầu chỉ lấy mốc nên bài cũ không bị buff. Page của via được xoay vòng để dùng đều.">
                <span className="underline decoration-dotted cursor-help">Cách hoạt động</span>
              </Tooltip>
            </p>
          </div>
          <Space className="shrink-0" wrap size={8}>
            {onTogglePostHunterPaused && (
              <Tooltip title={postHunterPaused ? 'Bật săn bài tự động' : 'Tạm dừng toàn bộ'}>
                <Switch checked={!postHunterPaused} loading={togglingGlobalPause} onChange={handleGlobalPauseSwitch} />
              </Tooltip>
            )}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'refresh', icon: <ReloadOutlined />, label: 'Làm mới', onClick: onRefresh },
                  { key: 'test', icon: <SearchOutlined />, label: 'Quét thử link', onClick: () => setTestOpen(true) },
                  { key: 'report', icon: <SendOutlined />, label: 'Gửi báo cáo 24h về Telegram', disabled: sendingReport, onClick: handleSendDailyReport },
                  { type: 'divider' },
                  {
                    key: 'own',
                    icon: <SettingOutlined />,
                    label: `Tự buff bài app đăng: ${autoBuffOwnPosts ? 'Bật' : 'Tắt'}`,
                    onClick: onOpenSettings,
                  },
                ],
              }}
            >
              <Button icon={<MoreOutlined />} aria-label="Thêm thao tác" />
            </Dropdown>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => onAdd()}>
              Thêm mục tiêu
            </Button>
          </Space>
        </div>

        {/* Số liệu vận hành */}
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
            Đang tạm dừng: không quét bài mới. Đơn chạy tay trong Hàng đợi vẫn chạy.
          </div>
        )}
      </div>

      {/* Danh sách mục tiêu */}
      <div className="app-surface overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
          <Segmented<MonitorFilter>
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: `Tất cả ${monitors.length}` },
              { value: 'ACTIVE', label: `Đang chạy ${stats.active}` },
              { value: 'PAUSED', label: `Tạm dừng ${monitors.length - stats.active}` },
              ...(stats.attention > 0 ? [{ value: 'ATTENTION' as MonitorFilter, label: `Cần xem lại ${stats.attention}` }] : []),
            ]}
          />
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined className="text-slate-500" />}
            placeholder="Tìm mục tiêu"
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
          pagination={filteredMonitors.length > 10 ? { pageSize: 10, showTotal: (t) => `${t} mục tiêu` } : false}
          locale={{
            emptyText:
              monitors.length === 0 ? (
                <div className="py-10">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span className="text-slate-400 text-xs">Chưa có mục tiêu nào</span>}
                  >
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => onAdd()}>
                      Thêm mục tiêu
                    </Button>
                  </Empty>
                </div>
              ) : (
                <div className="py-8 text-xs text-slate-400">Không có mục tiêu phù hợp</div>
              ),
          }}
        />
      </div>

      {/* Bài bắt gần đây */}
      <div className="app-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80">
          <div className="text-[13px] font-semibold text-slate-100">Bài mới bắt được</div>
          <Button type="link" size="small" className="!p-0 text-xs" onClick={onOpenQueue}>
            Xem hàng đợi
          </Button>
        </div>
        {recentCatches.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">Chưa có bài nào.</div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {recentCatches.map((task) => {
              const source =
                task.source === 'AUTO_OWN_POST' ? 'Bài app đăng' : task.monitorName && task.monitorName !== 'Post Hunter' ? task.monitorName : null;
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

      {/* Quét thử link */}
      <Modal
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        title="Quét thử link"
        footer={null}
        width={720}
        className="dark-modal"
        destroyOnHidden
      >
        <p className="text-xs text-slate-400 mb-3">
          Đọc các bài mới nhất của một Fanpage hoặc Group bằng via đang sống. Chỉ đọc, không tương tác.
        </p>
        <div className="flex gap-2">
          <Input
            autoFocus
            allowClear
            placeholder="https://www.facebook.com/groups/... hoặc link Fanpage"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            onPressEnter={runTestScan}
          />
          <Button type="primary" loading={testLoading} onClick={runTestScan}>
            Quét thử
          </Button>
        </div>

        {testLoading && <div className="text-xs text-slate-400 mt-3">Đang mở Facebook bằng via, thường mất 15–40 giây...</div>}

        {testResult && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>
                Thấy {testResult.posts.length} bài{testResult.scanVia ? ` · quét bằng ${testResult.scanVia}` : ''}
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
                  Theo dõi link này
                </Button>
              )}
            </div>
            {testResult.posts.length === 0 ? (
              <div className="text-xs text-amber-400 py-3">
                Không đọc được bài nào. Kiểm tra link, hoặc via có phải thành viên Group không.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/70 max-h-72 overflow-y-auto">
                {testResult.posts.map((p: any, idx: number) => (
                  <div key={p.url || idx} className="px-3 py-2 flex items-center gap-3 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-200 truncate">{(p.title || 'Bài viết Facebook').split('\n')[0]}</div>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[11px] text-blue-400 hover:underline">
                        {shortUrl(p.url)}
                      </a>
                    </div>
                    <div className="shrink-0 w-28">
                      {p.isAlreadyBuffed ? (
                        <Badge status="success" text={<span className="text-[11px] text-slate-300">Đã buff</span>} />
                      ) : p.isInQueue ? (
                        <Badge status="warning" text={<span className="text-[11px] text-slate-300">Trong hàng đợi</span>} />
                      ) : (
                        <Badge status="default" text={<span className="text-[11px] text-slate-300">Chưa buff</span>} />
                      )}
                    </div>
                    <Button
                      size="small"
                      onClick={() => {
                        setTestOpen(false);
                        onQueueUrl(p.url);
                      }}
                    >
                      Buff bài này
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
