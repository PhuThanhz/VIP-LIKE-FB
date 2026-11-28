import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { App, Badge, Button, DatePicker, Empty, Input, InputNumber, Segmented, Select, Space, Switch, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AimOutlined, ExportOutlined, PlusOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons';

// Post scanner (ported from the TOOLZUTTER feed hunter): read posts of a Group / Fanpage / keyword search
// with caption, posted time and engagement counts, then send the chosen posts to buff. Read-only scan.

export interface ScannedPost {
  id?: string;
  url: string;
  normalizedUrl: string;
  author?: string;
  caption: string;
  previewCover?: string;
  mediaType?: 'VIDEO' | 'IMAGE' | 'TEXT';
  postedTime?: string;
  publishedAt?: string;
  reactions: number;
  comments: number;
  shares: number;
  viralScore: number;
  isViral?: boolean;
  isAlreadyBuffed: boolean;
  buffedLikes: number;
  queueStatus: 'QUEUED' | 'RUNNING' | null;
}

interface ScanResult {
  groupName?: string;
  sourceType?: 'PAGE' | 'GROUP';
  scannedCount?: number;
  unknownDateCount?: number;
  dateFiltered?: boolean;
  scanVia?: string | null;
  items: ScannedPost[];
}

interface Props {
  workerBaseUrl: string;
  onBuffUrl: (url: string) => void;
  onMonitorUrl: (url: string) => void;
  onOpenQueue: () => void;
}

type Mode = 'LINK' | 'KEYWORD';

const nf = new Intl.NumberFormat('vi-VN');

function formatPosted(p: ScannedPost): string {
  if (p.publishedAt) {
    return new Date(p.publishedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  return p.postedTime || 'Không rõ';
}

export default function PostScanTab({ workerBaseUrl, onBuffUrl, onMonitorUrl, onOpenQueue }: Props) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<Mode>('LINK');
  const [targetUrl, setTargetUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [limit, setLimit] = useState(20);
  const [dateRange, setDateRange] = useState<any[] | null>(null);
  const [sortViral, setSortViral] = useState(false);
  const [minReactions, setMinReactions] = useState<number>(0);
  const [vias, setVias] = useState<{ id: number | string; name: string; uid: string | null }[]>([]);
  const [viaId, setViaId] = useState<string | number | undefined>(undefined);

  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [bulkLikes, setBulkLikes] = useState(30);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'NOT_BUFFED' | 'BUFFED'>('ALL');

  useEffect(() => {
    axios
      .get(`${workerBaseUrl}/api/post-scan/vias`)
      .then((res) => setVias(res.data?.vias || []))
      .catch(() => setVias([]));
  }, [workerBaseUrl]);

  const runScan = async () => {
    if (mode === 'LINK' && !targetUrl.trim()) {
      message.warning('Dán link Group hoặc Fanpage cần quét');
      return;
    }
    if (mode === 'KEYWORD' && !keyword.trim()) {
      message.warning('Nhập từ khóa cần tìm');
      return;
    }
    setScanning(true);
    setScanError(null);
    setSelectedKeys([]);
    try {
      const res = await axios.post(
        `${workerBaseUrl}/api/post-scan`,
        {
          targetUrl: mode === 'LINK' ? targetUrl.trim() : '',
          keyword: mode === 'KEYWORD' ? keyword.trim() : mode === 'LINK' && keyword.trim() ? keyword.trim() : '',
          limit,
          dateFrom: dateRange?.[0] ? dateRange[0].format('YYYY-MM-DD') : null,
          dateTo: dateRange?.[1] ? dateRange[1].format('YYYY-MM-DD') : null,
          sortViral,
          minReactions,
          viaId,
        },
        { timeout: 10 * 60 * 1000 }
      );
      if (res.data?.success) {
        setResult({ ...res.data, items: res.data.items || [] });
        if (!res.data.items?.length) setScanError('Quét xong nhưng không thấy bài nào khớp điều kiện.');
      } else {
        setScanError(res.data?.error || 'Quét thất bại');
      }
    } catch (err: any) {
      setScanError(err.response?.data?.error || err.message);
    } finally {
      setScanning(false);
    }
  };

  const addSelectedToQueue = async () => {
    const urls = (result?.items || []).filter((p) => selectedKeys.includes(p.normalizedUrl)).map((p) => p.url);
    if (!urls.length) return;
    setAdding(true);
    try {
      const res = await axios.post(`${workerBaseUrl}/api/buff-queue/batch-add`, {
        urls,
        targetLikes: bulkLikes,
        reactionType: 'RANDOM_POSITIVE',
        delayMinutes: 0,
        staggerMinutes: 3,
      });
      if (res.data?.success) {
        const added = res.data.added?.length ?? urls.length;
        const skipped = res.data.skipped?.length || 0;
        message.success(`Đã thêm ${added} bài vào hàng đợi${skipped ? `, bỏ qua ${skipped} bài đã buff` : ''}.`);
        setResult((prev) =>
          prev
            ? { ...prev, items: prev.items.map((p) => (selectedKeys.includes(p.normalizedUrl) && !p.isAlreadyBuffed ? { ...p, queueStatus: 'QUEUED' } : p)) }
            : prev
        );
        setSelectedKeys([]);
      } else {
        message.error(res.data?.error || 'Không thêm được vào hàng đợi');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setAdding(false);
    }
  };

  const items = useMemo(() => {
    const list = result?.items || [];
    if (filter === 'NOT_BUFFED') return list.filter((p) => !p.isAlreadyBuffed && !p.queueStatus);
    if (filter === 'BUFFED') return list.filter((p) => p.isAlreadyBuffed || p.queueStatus);
    return list;
  }, [result, filter]);

  const totals = useMemo(() => {
    const list = result?.items || [];
    return {
      all: list.length,
      notBuffed: list.filter((p) => !p.isAlreadyBuffed && !p.queueStatus).length,
      buffed: list.filter((p) => p.isAlreadyBuffed || p.queueStatus).length,
    };
  }, [result]);

  const columns: ColumnsType<ScannedPost> = [
    {
      title: 'Bài viết',
      key: 'post',
      render: (_, p) => (
        <div className="flex gap-3 min-w-0">
          {p.previewCover ? (
            <img src={p.previewCover} alt="" className="w-14 h-14 rounded-md object-cover shrink-0 bg-slate-800" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-14 h-14 rounded-md shrink-0 bg-slate-800/70 flex items-center justify-center text-[10px] text-slate-500">
              {p.mediaType === 'VIDEO' ? 'Video' : 'Chữ'}
            </div>
          )}
          <div className="min-w-0">
            <Tooltip title={<span className="whitespace-pre-line">{p.caption}</span>} placement="topLeft">
              <div className="text-[13px] text-slate-200 line-clamp-2 whitespace-pre-line">{p.caption}</div>
            </Tooltip>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
              {p.author ? `${p.author} · ` : ''}
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                Mở bài
              </a>
              {p.isViral && <span className="ml-1.5 text-amber-300">🔥 Viral</span>}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Đăng lúc',
      key: 'posted',
      width: 120,
      sorter: (a, b) => new Date(a.publishedAt || 0).getTime() - new Date(b.publishedAt || 0).getTime(),
      // Default: newest posts on top (the main use is checking a Fanpage's latest posts); viral mode keeps the server order
      defaultSortOrder: sortViral ? undefined : 'descend',
      render: (_, p) => <span className="text-xs text-slate-300 whitespace-nowrap">{formatPosted(p)}</span>,
    },
    {
      title: 'Tương tác',
      key: 'engagement',
      width: 170,
      sorter: (a, b) => a.viralScore - b.viralScore,
      render: (_, p) => (
        <div className="text-xs text-slate-300 whitespace-nowrap">
          <Tooltip title="Cảm xúc">👍 {nf.format(p.reactions)}</Tooltip>
          <Tooltip title="Bình luận">
            <span className="ml-2">💬 {nf.format(p.comments)}</span>
          </Tooltip>
          <Tooltip title="Chia sẻ">
            <span className="ml-2">↗ {nf.format(p.shares)}</span>
          </Tooltip>
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 150,
      render: (_, p) =>
        p.queueStatus === 'RUNNING' ? (
          <Badge status="processing" text={<span className="text-xs text-slate-300">Đang buff</span>} />
        ) : p.queueStatus === 'QUEUED' ? (
          <Badge status="warning" text={<span className="text-xs text-slate-300">Trong hàng đợi</span>} />
        ) : p.isAlreadyBuffed ? (
          <Badge status="success" text={<span className="text-xs text-slate-300">Đã buff {nf.format(p.buffedLikes)} like</span>} />
        ) : (
          <Badge status="default" text={<span className="text-xs text-slate-300">Chưa buff</span>} />
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_, p) => (
        <Space size={4}>
          <Tooltip title="Nạp bài vào form Tạo mới để buff">
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => onBuffUrl(p.url)}>
              Buff
            </Button>
          </Tooltip>
          <Tooltip title="Mở trên Facebook">
            <Button size="small" type="text" icon={<ExportOutlined />} href={p.url} target="_blank" aria-label="Mở trên Facebook" />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="app-surface p-4 space-y-3">
        <div>
          <div className="text-[15px] font-semibold text-slate-100">Quét bài Fanpage / Group</div>
          <p className="text-xs text-slate-500 mt-1">
            Đọc bài của Group, Fanpage hoặc tìm theo từ khóa bằng một Via: nội dung, giờ đăng, lượt tương tác. Chỉ đọc, không tương tác. Chọn bài
            rồi bấm thêm vào hàng đợi để buff.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-2">
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'LINK', label: 'Link Group / Fanpage' },
              { value: 'KEYWORD', label: 'Từ khóa' },
            ]}
          />
          {mode === 'LINK' ? (
            <Input
              allowClear
              placeholder="https://www.facebook.com/groups/... hoặc link Fanpage"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              onPressEnter={runScan}
            />
          ) : (
            <Input allowClear placeholder="VD: áo polo nam, nhà đất Thủ Đức..." value={keyword} onChange={(e) => setKeyword(e.target.value)} onPressEnter={runScan} />
          )}
          <Button type="primary" icon={<SearchOutlined />} loading={scanning} onClick={runScan}>
            Quét
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
          <span className="flex items-center gap-2">
            Số bài
            <Select
              size="small"
              value={limit}
              onChange={setLimit}
              style={{ width: 80 }}
              options={[10, 20, 50, 100].map((n) => ({ value: n, label: String(n) }))}
            />
          </span>
          <span className="flex items-center gap-2">
            Ngày đăng
            <DatePicker.RangePicker size="small" format="DD/MM/YYYY" value={dateRange as any} onChange={(v) => setDateRange(v as any)} allowEmpty={[true, true]} placeholder={['Từ ngày', 'Đến ngày']} />
          </span>
          <span className="flex items-center gap-2">
            Tối thiểu
            <InputNumber size="small" min={0} value={minReactions} onChange={(v) => setMinReactions(Number(v) || 0)} style={{ width: 80 }} />
            cảm xúc
          </span>
          <span className="flex items-center gap-2">
            <Switch size="small" checked={sortViral} onChange={setSortViral} />
            Xếp theo độ viral
          </span>
          {mode === 'LINK' && (
            <span className="flex items-center gap-2">
              Lọc chữ
              <Input size="small" allowClear placeholder="không bắt buộc" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 140 }} />
            </span>
          )}
          <span className="flex items-center gap-2">
            Quét bằng
            <Select
              size="small"
              value={viaId}
              onChange={setViaId}
              placeholder={vias.length ? 'Via đầu tiên' : 'Chưa có Via live'}
              allowClear
              style={{ width: 190 }}
              options={vias.map((v) => ({ value: v.id, label: `${v.name}${v.uid ? ` (${v.uid})` : ''}` }))}
            />
          </span>
        </div>

        {scanning && <div className="text-xs text-slate-400">Đang mở Facebook bằng Via và cuộn feed, thường mất 30 giây – 2 phút tùy số bài...</div>}
        {!scanning && scanError && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">{scanError}</div>
        )}
        {!scanning && vias.length === 0 && (
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            Chưa có Via nào còn sống. Vào "Via &amp; Fanpage" thêm Via trước khi quét.
          </div>
        )}
      </div>

      <div className="app-surface overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-100 truncate">
              {result ? result.groupName || 'Kết quả quét' : 'Kết quả quét'}
            </div>
            {result && (
              <div className="text-[11px] text-slate-500">
                {result.sourceType === 'PAGE' ? 'Fanpage' : result.sourceType === 'GROUP' ? 'Group' : 'Tìm kiếm'} · đã đọc {result.scannedCount ?? result.items.length} bài
                {result.scanVia ? ` · quét bằng ${result.scanVia}` : ''}
                {result.dateFiltered && result.unknownDateCount ? ` · ${result.unknownDateCount} bài không rõ ngày` : ''}
              </div>
            )}
          </div>
          <Space wrap size={8}>
            {result && (
              <Segmented
                size="small"
                value={filter}
                onChange={(v) => setFilter(v as any)}
                options={[
                  { value: 'ALL', label: `Tất cả ${totals.all}` },
                  { value: 'NOT_BUFFED', label: `Chưa buff ${totals.notBuffed}` },
                  { value: 'BUFFED', label: `Đã buff / chờ ${totals.buffed}` },
                ]}
              />
            )}
            {mode === 'LINK' && targetUrl.trim() && result && (
              <Tooltip title="Tạo monitor để tự buff bài mới của trang này">
                <Button size="small" icon={<AimOutlined />} onClick={() => onMonitorUrl(targetUrl.trim())}>
                  Theo dõi trang này
                </Button>
              </Tooltip>
            )}
          </Space>
        </div>

        {selectedKeys.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-slate-800/80 bg-cyan-500/5 text-xs text-slate-300">
            Đã chọn <b>{selectedKeys.length}</b> bài · mỗi bài
            <Select
              size="small"
              value={bulkLikes}
              onChange={setBulkLikes}
              style={{ width: 100 }}
              options={[20, 30, 50, 100, 200].map((n) => ({ value: n, label: `${n} like` }))}
            />
            <Button size="small" type="primary" icon={<PlusOutlined />} loading={adding} onClick={addSelectedToQueue}>
              Thêm vào hàng đợi
            </Button>
            <Button size="small" type="link" onClick={onOpenQueue}>
              Xem hàng đợi
            </Button>
            <span className="text-slate-500">Các bài chạy cách nhau 3 phút.</span>
          </div>
        )}

        <Table<ScannedPost>
          rowKey="normalizedUrl"
          size="middle"
          columns={columns}
          dataSource={items}
          tableLayout="fixed"
          scroll={{ x: 820 }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: setSelectedKeys,
            getCheckboxProps: (p) => ({ disabled: Boolean(p.queueStatus) }),
          }}
          pagination={items.length > 20 ? { pageSize: 20, showTotal: (t) => `${t} bài` } : false}
          locale={{
            emptyText: (
              <div className="py-10">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span className="text-slate-400 text-xs">{result ? 'Không có bài nào trong bộ lọc này' : 'Dán link Group/Fanpage hoặc nhập từ khóa rồi bấm Quét'}</span>
                  }
                />
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
}
