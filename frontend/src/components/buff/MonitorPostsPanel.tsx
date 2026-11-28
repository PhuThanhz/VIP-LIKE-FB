import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Badge, Button, Segmented, Spin, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

export interface MonitorPostEntry {
  url: string;
  normalizedUrl: string;
  title: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'BASELINE' | 'PINNED' | 'ALREADY_BUFFED' | 'SKIPPED_LIMIT' | 'QUEUED';
  taskId: string | null;
  note: string | null;
  task: {
    id: string;
    status: string;
    runAfter: string | null;
    progress: { done: number; total: number } | null;
    result: { success: number; total: number } | null;
    targetLikes: number | 'ALL';
    error: string | null;
  } | null;
  buffed: { totalSuccess: number; lastBuffedAt: string | null } | null;
}

type PostFilter = 'ALL' | 'CAUGHT' | 'SKIPPED' | 'IGNORED';

interface Props {
  workerBaseUrl: string;
  monitorId: string;
  onQueueUrl: (url: string) => void;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, 'facebook.com/').replace(/\/$/, '');
}

// Current buff state of a logged post: the live queue task wins, then buff history, then the scan decision
function describe(entry: MonitorPostEntry): { badge: 'default' | 'processing' | 'success' | 'error' | 'warning'; text: string; detail?: string } {
  const t = entry.task;
  if (t) {
    if (t.status === 'RUNNING') return { badge: 'processing', text: t.progress?.total ? `Buffing ${t.progress.done}/${t.progress.total}` : 'Buffing' };
    if (t.status === 'QUEUED') {
      const wait = t.runAfter ? new Date(t.runAfter).getTime() - Date.now() : 0;
      return { badge: 'warning', text: 'Waiting to buff', detail: wait > 60000 ? `starts in ${Math.ceil(wait / 60000)} min` : undefined };
    }
    if (t.status === 'COMPLETED') return { badge: 'success', text: 'Buffed', detail: t.result ? `${t.result.success}/${t.result.total} likes` : undefined };
    if (t.status === 'PARTIAL') return { badge: 'warning', text: 'Partially done', detail: t.result ? `${t.result.success}/${t.result.total} likes` : undefined };
    if (t.status === 'FAILED') return { badge: 'error', text: 'Failed', detail: t.error || undefined };
    if (t.status === 'NEEDS_REVIEW') return { badge: 'warning', text: 'Needs review', detail: t.error || undefined };
    if (t.status === 'CANCELLED' || t.status === 'STOPPED') return { badge: 'default', text: 'Cancelled' };
  }
  if (entry.buffed) return { badge: 'success', text: 'Buffed', detail: `${entry.buffed.totalSuccess} likes · ${formatTime(entry.buffed.lastBuffedAt)}` };
  switch (entry.status) {
    case 'BASELINE':
      return { badge: 'default', text: 'Old post (baseline)', detail: 'Existed before monitoring started' };
    case 'PINNED':
      return { badge: 'default', text: 'Pinned, skipped' };
    case 'SKIPPED_LIMIT':
      return { badge: 'warning', text: 'Held by daily limit', detail: 'Retried automatically after the daily reset' };
    case 'ALREADY_BUFFED':
      return { badge: 'success', text: 'Buffed earlier' };
    case 'QUEUED':
      return { badge: 'default', text: 'Task removed from queue', detail: 'The queue was cleared before the result was saved' };
    default:
      return { badge: 'default', text: entry.status };
  }
}

function matchesFilter(entry: MonitorPostEntry, filter: PostFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'CAUGHT') return entry.status === 'QUEUED';
  if (filter === 'SKIPPED') return entry.status === 'SKIPPED_LIMIT';
  return entry.status === 'BASELINE' || entry.status === 'PINNED' || entry.status === 'ALREADY_BUFFED';
}

export default function MonitorPostsPanel({ workerBaseUrl, monitorId, onQueueUrl }: Props) {
  const [posts, setPosts] = useState<MonitorPostEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PostFilter>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${workerBaseUrl}/api/buff-monitors/${monitorId}/posts`);
      if (res.data?.success) {
        setPosts(res.data.posts || []);
        setError(null);
      } else {
        setError(res.data?.error || 'Could not load posts');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [workerBaseUrl, monitorId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  if (posts === null) {
    return <div className="py-6 text-center">{error ? <span className="text-xs text-rose-300">{error}</span> : <Spin size="small" />}</div>;
  }

  const counts = {
    ALL: posts.length,
    CAUGHT: posts.filter((p) => matchesFilter(p, 'CAUGHT')).length,
    SKIPPED: posts.filter((p) => matchesFilter(p, 'SKIPPED')).length,
    IGNORED: posts.filter((p) => matchesFilter(p, 'IGNORED')).length,
  };
  const visible = posts.filter((p) => matchesFilter(p, filter));

  return (
    <div className="py-1">
      <div className="flex items-center justify-between gap-3 mb-2">
        <Segmented<PostFilter>
          size="small"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: `All ${counts.ALL}` },
            { value: 'CAUGHT', label: `Caught ${counts.CAUGHT}` },
            ...(counts.SKIPPED > 0 ? [{ value: 'SKIPPED' as PostFilter, label: `Held by limit ${counts.SKIPPED}` }] : []),
            { value: 'IGNORED', label: `Old / skipped ${counts.IGNORED}` },
          ]}
        />
        <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={load} aria-label="Reload posts" />
      </div>
      {posts.length === 0 ? (
        <div className="py-4 text-center text-xs text-slate-500">
          No scanned posts recorded yet. Posts appear here after the next scan.
        </div>
      ) : visible.length === 0 ? (
        <div className="py-4 text-center text-xs text-slate-500">No posts in this filter.</div>
      ) : (
        <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/70 max-h-80 overflow-y-auto">
          {visible.map((entry) => {
            const d = describe(entry);
            const canBuff = !entry.task || ['FAILED', 'CANCELLED', 'STOPPED'].includes(entry.task.status);
            const showBuff = canBuff && !entry.buffed && (entry.status === 'SKIPPED_LIMIT' || entry.status === 'BASELINE' || entry.task);
            return (
              <div key={entry.normalizedUrl} className="px-3 py-2 flex items-center gap-3 text-xs">
                <div className="w-24 shrink-0 text-slate-500" title={`Last seen ${formatTime(entry.lastSeenAt)}`}>
                  {formatTime(entry.firstSeenAt)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-200 truncate">{entry.title || 'Facebook post'}</div>
                  <a href={entry.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[11px] text-blue-400 hover:underline">
                    {shortUrl(entry.url)}
                  </a>
                </div>
                <div className="w-44 shrink-0">
                  <Tooltip title={d.detail}>
                    <div>
                      <Badge status={d.badge} text={<span className="text-[11px] text-slate-300">{d.text}</span>} />
                      {d.detail && <div className="text-[10px] text-slate-500 truncate pl-3.5">{d.detail}</div>}
                    </div>
                  </Tooltip>
                </div>
                <div className="w-24 shrink-0 text-right">
                  {showBuff && (
                    <Button size="small" onClick={() => onQueueUrl(entry.url)}>
                      Buff now
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
