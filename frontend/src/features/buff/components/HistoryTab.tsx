import React, { useMemo, useState } from 'react';
import { App, Button, Card, Col, Dropdown, Input, Row, Select, Table, Tag } from 'antd';
import type { BuffLogEntry } from '../types';
import { CopyOutlined, ExportOutlined, HistoryOutlined, MoreOutlined, PlayCircleOutlined, RedoOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { REACTIONS } from '../constants';
import { TableSkeleton } from '../../../components/common/SaaSLoadingSkeleton';
import api from '../../../config/axios';
import { getLogCounts } from '../utils';

export interface HistoryTabProps {
  buffLogs: BuffLogEntry[];
  setBuffLogs: React.Dispatch<React.SetStateAction<BuffLogEntry[]>>;
  buffLogsLoading: boolean;
  reloadBuffLogs: (silent?: boolean) => Promise<void>;
  handleViewLogDetail: (log: BuffLogEntry) => void;
  loadingLogDetailId: string | null;
  /** Kept in the parent because the Queue tab has a "View history" button that pre-fills the search */
  logSearchQuery: string;
  setLogSearchQuery: (q: string) => void;
  onGoCreate: () => void;
  onBuffAgain: (log: BuffLogEntry) => void;
}

/** Engagement history tab: stats, filters, log table, CSV export */
export default function HistoryTab({
  buffLogs,
  setBuffLogs,
  buffLogsLoading,
  reloadBuffLogs,
  handleViewLogDetail,
  loadingLogDetailId,
  logSearchQuery,
  setLogSearchQuery,
  onGoCreate,
  onBuffAgain,
}: HistoryTabProps) {
  const { message, modal } = App.useApp();
  const [logFilterReaction, setLogFilterReaction] = useState<string>('ALL');
  const [logFilterTime, setLogFilterTime] = useState<'ALL' | 'TODAY' | '7D' | '30D'>('ALL');
  const [logFilterType, setLogFilterType] = useState<'ALL' | 'SINGLE' | 'BATCH' | 'QUEUE'>('ALL');
  const [logFilterVia, setLogFilterVia] = useState<string>('ALL');
  const [logFilterResult, setLogFilterResult] = useState<'ALL' | 'CLEAN' | 'UNVERIFIED' | 'FAILED'>('ALL');

  const logViaOptions = useMemo(
    () => Array.from(new Set(buffLogs.map((l) => l.accountName).filter(Boolean) as string[])).sort(),
    [buffLogs]
  );

  const hasActiveLogFilter =
    Boolean(logSearchQuery.trim()) ||
    logFilterReaction !== 'ALL' ||
    logFilterTime !== 'ALL' ||
    logFilterType !== 'ALL' ||
    logFilterVia !== 'ALL' ||
    logFilterResult !== 'ALL';

  const resetLogFilters = () => {
    setLogSearchQuery('');
    setLogFilterReaction('ALL');
    setLogFilterTime('ALL');
    setLogFilterType('ALL');
    setLogFilterVia('ALL');
    setLogFilterResult('ALL');
  };

  const filteredBuffLogs = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const minTime =
      logFilterTime === 'TODAY'
        ? startOfToday.getTime()
        : logFilterTime === '7D'
          ? Date.now() - 7 * 86400000
          : logFilterTime === '30D'
            ? Date.now() - 30 * 86400000
            : 0;
    const rawQ = logSearchQuery.toLowerCase().trim();
    const q = rawQ.replace(/\/+$/, '');

    return buffLogs
      .filter((log) => {
        if (minTime && new Date(log.createdAt).getTime() < minTime) return false;
        if (logFilterType !== 'ALL' && log.type !== logFilterType) return false;
        if (logFilterVia !== 'ALL' && log.accountName !== logFilterVia) return false;
        if (logFilterReaction !== 'ALL' && log.reactionType !== logFilterReaction) return false;
        if (logFilterResult !== 'ALL') {
          const c = getLogCounts(log);
          if (logFilterResult === 'CLEAN' && (c.failed > 0 || c.unverified > 0)) return false;
          if (logFilterResult === 'UNVERIFIED' && c.unverified === 0) return false;
          if (logFilterResult === 'FAILED' && c.failed === 0) return false;
        }
        if (!q) return true;
        const logUrl = (log.targetUrl || '').toLowerCase().replace(/\/+$/, '');
        return (
          logUrl.includes(q) ||
          q.includes(logUrl) ||
          Boolean((log.accountName || '').toLowerCase().includes(q)) ||
          (Array.isArray(log.details) &&
            log.details.some(
              (d) =>
                (d.pageName || '').toLowerCase().includes(q) ||
                String(d.pageId || '').includes(q)
            ))
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [buffLogs, logSearchQuery, logFilterReaction, logFilterTime, logFilterType, logFilterVia, logFilterResult]);

  // Export the engagement history report to CSV (UTF-8 BOM for Excel)
  const handleExportLogsToCsv = () => {
    if (filteredBuffLogs.length === 0) {
      message.warning('No rows match the filter to export!');
      return;
    }
    const headers = [
      'Time',
      'Campaign Type',
      'Post Link',
      'Account / Via',
      'Reaction',
      'Total Pages',
      'Success',
      'Already Liked',
      'Failed',
      'Page Details',
    ];
    const rows = filteredBuffLogs.map((log) => {
      const time = new Date(log.createdAt).toLocaleString('vi-VN');
      const type = log.type === 'QUEUE' ? 'Queue' : log.type === 'BATCH' ? 'Batch' : 'Single';
      const url = `"${(log.targetUrl || '').replace(/"/g, '""')}"`;
      const acc = `"${(log.accountName || '').replace(/"/g, '""')}"`;
      const reaction = log.reactionType || 'LIKE';
      const counts = getLogCounts(log);
      const total = counts.total;
      const success = counts.success;
      const already = counts.alreadyLiked;
      const failed = counts.failed;
      const pageNames = `"${log.details.map((d) => `${d.pageName} [${d.status}]`).join('; ').replace(/"/g, '""')}"`;
      return [time, type, url, acc, reaction, total, success, already, failed, pageNames].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Bao_Cao_Buff_Tuong_Tac_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    message.success(`Exported ${filteredBuffLogs.length} rows to CSV!`);
  };


  return (
              <div className="space-y-4">
                {/* Metric Summary Cards */}
                <Row gutter={[12, 12]}>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 app-surface text-center">
                      <div className="text-[11px] font-bold text-slate-400 uppercase">Total runs</div>
                      <div className="text-2xl font-semibold text-slate-100 mt-1">{buffLogs.length}</div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-center">
                      <div className="text-[11px] font-bold text-emerald-400 uppercase">Successful likes</div>
                      <div className="text-2xl font-semibold text-emerald-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + getLogCounts(l).success, 0)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30 text-center">
                      <div className="text-[11px] font-bold text-blue-400 uppercase">Already liked</div>
                      <div className="text-2xl font-semibold text-blue-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + getLogCounts(l).alreadyLiked, 0)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/30 text-center">
                      <div className="text-[11px] font-bold text-rose-400 uppercase">Errors / Failed</div>
                      <div className="text-2xl font-semibold text-rose-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + getLogCounts(l).failed, 0)}
                      </div>
                    </div>
                  </Col>
                </Row>

                {/* Filter and Actions Bar */}
                <Card className="app-surface p-0">
                  <div className="p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        prefix={<SearchOutlined className="text-slate-400" />}
                        placeholder="Search by post link, Via or Page name..."
                        value={logSearchQuery}
                        onChange={(e) => setLogSearchQuery(e.target.value)}
                        className="flex-1 min-w-[240px]"
                        allowClear
                      />
                      {logSearchQuery && (
                        <div className="w-full flex items-center justify-between p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/60 text-xs text-slate-300">
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-cyan-400 font-semibold">🔍 Filtering by post:</span>
                            <span className="font-mono text-cyan-300 truncate max-w-md">{logSearchQuery}</span>
                          </div>
                          <Button size="small" type="link" onClick={() => setLogSearchQuery('')} className="text-xs text-cyan-400 p-0 font-semibold shrink-0">
                            View all history (clear filter)
                          </Button>
                        </div>
                      )}
                      {buffLogs.length > 0 && (
                        <>
                          <Button
                            icon={<ReloadOutlined spin={buffLogsLoading} />}
                            onClick={() => {
                              reloadBuffLogs(false);
                              message.success('History refreshed');
                            }}
                          >
                            Refresh
                          </Button>
                          <Button onClick={handleExportLogsToCsv} disabled={filteredBuffLogs.length === 0}>
                            {hasActiveLogFilter ? `Export CSV (${filteredBuffLogs.length})` : 'Export CSV'}
                          </Button>
                          <Button
                            danger
                          onClick={() => {
                            modal.confirm({
                              title: 'Delete all buff history?',
                              content: 'This will delete all saved logs. Are you sure?',
                              okText: 'Delete all',
                              cancelText: 'Cancel',
                              okButtonProps: { danger: true },
                              onOk: async () => {
                                try {
                                  await api.delete('/buff-logs');
                                  setBuffLogs([]);
                                  message.success('All buff history deleted!');
                                } catch (err: any) {
                                  message.error(err.response?.data?.error || err.message);
                                }
                              },
                            });
                          }}
                          type="text"
                        >
                          Delete history
                        </Button>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={logFilterTime}
                        onChange={setLogFilterTime}
                        className="w-36"
                        options={[
                          { value: 'ALL', label: 'All time' },
                          { value: 'TODAY', label: 'Today' },
                          { value: '7D', label: 'Last 7 days' },
                          { value: '30D', label: 'Last 30 days' },
                        ]}
                      />
                      <Select
                        value={logFilterType}
                        onChange={setLogFilterType}
                        className="w-36"
                        options={[
                          { value: 'ALL', label: 'All types' },
                          { value: 'QUEUE', label: 'Queue' },
                          { value: 'SINGLE', label: 'Single' },
                          { value: 'BATCH', label: 'Batch' },
                        ]}
                      />
                      <Select
                        value={logFilterVia}
                        onChange={setLogFilterVia}
                        className="w-48"
                        showSearch
                        optionFilterProp="label"
                        options={[
                          { value: 'ALL', label: 'All Vias' },
                          ...logViaOptions.map((v) => ({ value: v, label: v })),
                        ]}
                      />
                      <Select
                        value={logFilterResult}
                        onChange={setLogFilterResult}
                        className="w-40"
                        options={[
                          { value: 'ALL', label: 'All results' },
                          { value: 'CLEAN', label: 'All successful' },
                          { value: 'UNVERIFIED', label: 'Has unverified' },
                          { value: 'FAILED', label: 'Has errors' },
                        ]}
                      />
                      <Select
                        value={logFilterReaction}
                        onChange={(v) => setLogFilterReaction(v)}
                        className="w-36"
                        options={[
                          { value: 'ALL', label: 'All reactions' },
                          ...REACTIONS.map((r) => ({
                            value: r.key,
                            label: `${r.emoji} ${r.shortLabel}`,
                          })),
                        ]}
                      />

                      <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
                        {hasActiveLogFilter && (
                          <Button type="link" size="small" onClick={resetLogFilters} className="px-0 text-xs">
                            Clear filters
                          </Button>
                        )}
                        <span className="tabular-nums">
                          {filteredBuffLogs.length} / {buffLogs.length} runs
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* List / Table of Logs */}
                {buffLogsLoading && buffLogs.length === 0 ? (
                  <TableSkeleton rows={6} columns={5} />
                ) : buffLogs.length === 0 ? (
                  <Card className="app-surface text-center py-16 border-slate-800">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-3xl shadow-inner text-cyan-400">
                      <HistoryOutlined />
                    </div>
                    <div className="text-base font-bold text-slate-100">No engagement history yet</div>
                    <div className="text-xs text-slate-400 max-w-md mx-auto mt-2 leading-relaxed">
                      Whenever you run a live or background engagement campaign, its log and result report will show up here so you can track and reconcile them easily.
                    </div>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={onGoCreate}
                      className="mt-4 rounded-xl font-bold bg-cyan-600 hover:bg-cyan-500 border-none"
                    >
                      Start your first campaign
                    </Button>
                  </Card>
                ) : (
                  <Card className="app-surface p-0 overflow-hidden">
                    <Table<BuffLogEntry>
                      dataSource={filteredBuffLogs}
                      rowKey="id"
                      pagination={{ pageSize: 10, showTotal: (t) => `${t} buff runs in total` }}
                      scroll={{ x: 1000 }}
                      className="ant-table-dark-custom"
                      columns={[
                        {
                          title: 'Time',
                          dataIndex: 'createdAt',
                          key: 'createdAt',
                          width: 160,
                          sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                          defaultSortOrder: 'descend',
                          render: (val: string, log) => (
                            <div className="leading-tight">
                              <div className="text-sm text-slate-100 tabular-nums font-medium">
                                {new Date(val).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div className="text-xs text-slate-500 mt-1 tabular-nums whitespace-nowrap flex items-center gap-1.5">
                                <span>{new Date(val).toLocaleDateString('vi-VN')}</span>
                                {log.type === 'QUEUE' ? (
                                  <Tag color="cyan" className="m-0 border-0 text-[10px] px-1.5 py-0 leading-tight">Queue</Tag>
                                ) : log.type === 'BATCH' ? (
                                  <Tag color="purple" className="m-0 border-0 text-[10px] px-1.5 py-0 leading-tight">Batch</Tag>
                                ) : (
                                  <Tag color="blue" className="m-0 border-0 text-[10px] px-1.5 py-0 leading-tight">Single</Tag>
                                )}
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: 'Post',
                          key: 'targetUrl',
                          render: (_, log) => (
                            <div className="min-w-0 leading-tight">
                              <a
                                href={log.targetUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={log.targetUrl}
                                className="text-sm text-slate-100 hover:text-blue-400 truncate block max-w-sm"
                              >
                                {log.targetUrl.replace(/^https?:\/\/(www\.)?/, '')}
                              </a>
                              {log.accountName && (
                                <div className="text-xs text-slate-500 mt-1 truncate max-w-sm">
                                  Via: <span className="text-slate-300">{log.accountName}</span>
                                </div>
                              )}
                            </div>
                          ),
                        },
                        {
                          title: 'Reaction',
                          dataIndex: 'reactionType',
                          key: 'reactionType',
                          width: 120,
                          render: (reactionType: string) => {
                            const reactionObj = REACTIONS.find((r) => r.key === reactionType) || REACTIONS[0];
                            return (
                              <span className="inline-flex items-center gap-1.5 text-sm text-slate-200">
                                <span>{reactionObj.emoji}</span>
                                {reactionObj.shortLabel}
                              </span>
                            );
                          },
                        },
                        {
                          title: 'Result',
                          key: 'counts',
                          width: 200,
                          render: (_, log) => {
                            const counts = getLogCounts(log);
                            const extras = [
                              counts.comments > 0 && { text: `${counts.comments} comments`, cls: 'text-slate-400' },
                              counts.alreadyLiked > 0 && { text: `${counts.alreadyLiked} already liked`, cls: 'text-slate-400' },
                              counts.unverified > 0 && { text: `${counts.unverified} unverified`, cls: 'text-amber-400' },
                              counts.failed > 0 && { text: `${counts.failed} errors`, cls: 'text-rose-400' },
                            ].filter(Boolean) as { text: string; cls: string }[];
                            return (
                              <div className="leading-tight">
                                <div className="text-sm text-slate-200">
                                  <span className="font-semibold text-emerald-400 tabular-nums">{counts.success}</span> successful
                                </div>
                                {extras.length > 0 && (
                                  <div className="text-xs mt-1">
                                    {extras.map((e, i) => (
                                      <span key={e.text} className={e.cls}>
                                        {i > 0 && <span className="text-slate-600"> · </span>}
                                        {e.text}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          },
                        },
                        {
                          title: 'Fanpage',
                          key: 'details',
                          width: 150,
                          render: (_, log) => {
                            const counts = getLogCounts(log);
                            const pct = (n: number) => counts.total > 0 ? `${(n / counts.total) * 100}%` : '0%';
                            return (
                              <div className="leading-tight">
                                <div className="text-sm text-slate-200 tabular-nums">{counts.total} Page</div>
                                <div className="flex h-1 rounded-full overflow-hidden bg-slate-800 w-full max-w-[112px] mt-2">
                                  <div className="bg-emerald-500" style={{ width: pct(counts.success) }} />
                                  <div className="bg-slate-500" style={{ width: pct(counts.alreadyLiked) }} />
                                  <div className="bg-amber-500" style={{ width: pct(counts.unverified) }} />
                                  <div className="bg-rose-500" style={{ width: pct(counts.failed) }} />
                                </div>
                              </div>
                            );
                          },
                        },
                        {
                          title: '',
                          key: 'actions',
                          width: 175,
                          align: 'right',
                          render: (_, log) => (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="small"
                                type="primary"
                                ghost
                                icon={<RedoOutlined />}
                                onClick={() => onBuffAgain(log)}
                                className="text-xs font-semibold h-7 px-2"
                              >
                                Buff more
                              </Button>
                              <Button
                                size="small"
                                type="text"
                                onClick={() => handleViewLogDetail(log)}
                                loading={loadingLogDetailId === log.id}
                                className="text-xs text-slate-300 h-7 px-1.5"
                              >
                                Details
                              </Button>
                              <Dropdown
                                trigger={['click']}
                                menu={{
                                  items: [
                                    {
                                      key: 'open',
                                      label: 'Open on Facebook',
                                      icon: <ExportOutlined />,
                                      onClick: () => window.open(log.targetUrl, '_blank'),
                                    },
                                    {
                                      key: 'copy',
                                      label: 'Copy link',
                                      icon: <CopyOutlined />,
                                      onClick: () => {
                                        navigator.clipboard.writeText(log.targetUrl);
                                        message.success('Post link copied!');
                                      },
                                    },
                                  ],
                                }}
                              >
                                <Button size="small" type="text" icon={<MoreOutlined />} className="text-slate-400 h-7 px-1" />
                              </Dropdown>
                            </div>
                          ),
                        },
                      ]}
                    />
                  </Card>
                )}
              </div>
  );
}
