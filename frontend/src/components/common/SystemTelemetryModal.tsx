import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Tag, Button, Spin, Progress, Tooltip } from 'antd';
import {
  DashboardOutlined,
  ReloadOutlined,
  CheckCircleFilled,
  WarningFilled,
  ThunderboltFilled,
  DatabaseOutlined,
  CloudServerOutlined,
  LineChartOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';

interface TelemetryMetrics {
  timestamp: string;
  uptimeSeconds: number;
  throughput: {
    requestsPerSecond: number;
    requestsPerMinute: number;
    totalRequests: number;
  };
  latency: {
    global: {
      p50: number;
      p95: number;
      p99: number;
      min: number;
      max: number;
      avg: number;
      count: number;
    };
    slowestRoutes: Array<{
      route: string;
      p50: number;
      p95: number;
      p99: number;
      min: number;
      max: number;
      avg: number;
      count: number;
    }>;
  };
  errors: {
    errorRatePercent: number;
    statusCounts: {
      total: number;
      s2xx: number;
      s3xx: number;
      s4xx: number;
      s5xx: number;
    };
  };
  eventLoop: {
    meanLagMs: number;
    p99LagMs: number | null;
    healthy: boolean;
  };
  systemMemory: {
    rssMB: number;
    heapTotalMB: number;
    heapUsedMB: number;
    externalMB: number;
  };
  cpu?: {
    usagePercent: number;
    cores: number;
  };
  queueDepth?: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    partial: number;
    deadLetter: number;
  };
  workerHealth?: {
    status: string;
    consecutiveFailures: number;
    maxParallelVias: number;
    maxParallelTasks: number;
  };
  database: {
    status: string;
    pingMs: number | null;
  };
  concurrencyEngine: {
    activeBuffLanes: number;
    laneWaiters: number;
    activeTasksCount: number;
    activeSessionsCount: number;
  };
}

interface SystemTelemetryModalProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl?: string;
}

export const SystemTelemetryModal: React.FC<SystemTelemetryModalProps> = ({
  open,
  onClose,
  apiBaseUrl = '',
}) => {
  const [metrics, setMetrics] = useState<TelemetryMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBaseUrl}/api/system/observability`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success && data.metrics) {
        setMetrics(data.metrics);
      }
    } catch (err: any) {
      setError(err.message || 'Không thể lấy dữ liệu giám sát');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!open) return;
    fetchMetrics();
    if (!autoRefresh) return;
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, [open, autoRefresh, fetchMetrics]);

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={840}
      centered
      title={
        <div className="flex items-center justify-between pr-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <DashboardOutlined />
            </div>
            <div>
              <div className="text-sm font-extrabold text-white flex items-center gap-2">
                <span>BUFF LIKE 3.0 Telemetry &amp; Observability</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-mono">
                  Enterprise
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-normal">
                Giám sát thời gian thực: Độ trễ P50/P95, Event Loop lag, Database Ping &amp; Concurrency Engine
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              type={autoRefresh ? 'primary' : 'default'}
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={autoRefresh ? 'bg-cyan-600 hover:bg-cyan-500 text-xs' : 'text-xs text-slate-300'}
            >
              {autoRefresh ? '⚡ Tự cập nhật 3s' : 'Tạm dừng'}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined spin={loading} />}
              onClick={fetchMetrics}
              className="text-xs"
            >
              Làm mới
            </Button>
          </div>
        </div>
      }
      className="dark-telemetry-modal"
    >
      <div className="space-y-4 pt-2">
        {error && (
          <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
            <WarningFilled />
            <span>Lỗi tải số liệu giám sát: {error}</span>
          </div>
        )}

        {!metrics && loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <Spin size="large" />
            <span className="text-xs text-slate-400">Đang thu thập thông số Telemetry từ Node.js Event Loop...</span>
          </div>
        ) : metrics ? (
          <>
            {/* Top 4 KPI Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* API Latency Global */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-cyan-500/30">
                <div className="text-[11px] text-cyan-400 font-semibold flex items-center justify-between">
                  <span>Độ trễ API (P50/P95)</span>
                  <ThunderboltFilled className="text-cyan-400" />
                </div>
                <div className="text-xl font-mono font-extrabold text-white mt-1">
                  {metrics.latency.global.p50}ms
                  <span className="text-xs text-slate-400 font-normal ml-1">/ {metrics.latency.global.p95}ms</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-mono">
                  <span>Avg: {metrics.latency.global.avg}ms</span>
                  <span>•</span>
                  <span>Max: {metrics.latency.global.max}ms</span>
                </div>
              </div>

              {/* Event Loop Lag */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-emerald-500/30">
                <div className="text-[11px] text-emerald-400 font-semibold flex items-center justify-between">
                  <span>Event Loop Lag</span>
                  <FieldTimeOutlined className="text-emerald-400" />
                </div>
                <div className="text-xl font-mono font-extrabold text-white mt-1 flex items-center gap-1.5">
                  <span>{metrics.eventLoop.meanLagMs}ms</span>
                  <Tag
                    color={metrics.eventLoop.healthy ? 'success' : 'error'}
                    className="text-[9px] m-0 border-0 px-1 py-0"
                  >
                    {metrics.eventLoop.healthy ? 'HEALTHY' : 'LAG'}
                  </Tag>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {metrics.eventLoop.healthy ? 'Không bị chặn event loop' : 'Có tác vụ đồng bộ nặng'}
                </div>
              </div>

              {/* Database Status & Ping */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-blue-500/30">
                <div className="text-[11px] text-blue-400 font-semibold flex items-center justify-between">
                  <span>MySQL Latency</span>
                  <DatabaseOutlined className="text-blue-400" />
                </div>
                <div className="text-xl font-mono font-extrabold text-white mt-1">
                  {metrics.database.pingMs !== null ? `${metrics.database.pingMs}ms` : 'N/A'}
                </div>
                <div className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircleFilled className="text-[9px]" />
                  <span>Pool Active ({metrics.database.status})</span>
                </div>
              </div>

              {/* Memory & CPU Footprint */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-purple-500/30">
                <div className="text-[11px] text-purple-400 font-semibold flex items-center justify-between">
                  <span>RAM &amp; CPU</span>
                  <CloudServerOutlined className="text-purple-400" />
                </div>
                <div className="text-xl font-mono font-extrabold text-white mt-1">
                  {metrics.systemMemory.heapUsedMB}MB
                  <span className="text-xs text-slate-400 font-normal ml-1">/ {metrics.systemMemory.rssMB}MB</span>
                </div>
                <div className="text-[10px] text-purple-300 mt-1 flex items-center justify-between font-mono">
                  <span>CPU: {metrics.cpu?.usagePercent || 0}%</span>
                  <span className="text-slate-400">({metrics.cpu?.cores || 1} Cores)</span>
                </div>
              </div>
            </div>

            {/* Throughput & Concurrency Engine Status */}
            <div className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <LineChartOutlined className="text-cyan-400" />
                  Hạ tầng Xử lý Song song &amp; Tải Hệ thống
                </span>
                <span className="text-slate-400 font-mono text-[11px]">
                  Uptime: {formatUptime(metrics.uptimeSeconds)} • {metrics.throughput.totalRequests} reqs
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Lưu lượng RPS / RPM</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {metrics.throughput.requestsPerSecond} req/s <span className="text-[10px] text-slate-400">({metrics.throughput.requestsPerMinute} rpm)</span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Làn Buff Đang Chạy (Lanes)</div>
                  <div className="font-mono font-bold text-cyan-300 mt-0.5">
                    {metrics.concurrencyEngine.activeBuffLanes} active <span className="text-[10px] text-slate-400">({metrics.concurrencyEngine.laneWaiters} chờ)</span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Hàng đợi (Queue Depth)</div>
                  <div className="font-mono font-bold text-emerald-300 mt-0.5">
                    {metrics.queueDepth ? (
                      <span>{metrics.queueDepth.queued} chờ / {metrics.queueDepth.running} chạy</span>
                    ) : (
                      `${metrics.concurrencyEngine.activeTasksCount} đang thực thi`
                    )}
                  </div>
                  {metrics.queueDepth && metrics.queueDepth.deadLetter > 0 && (
                    <div className="text-[9px] text-rose-400 font-semibold mt-0.5">
                      ⚠️ {metrics.queueDepth.deadLetter} task Dead-Letter
                    </div>
                  )}
                </div>

                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Tỷ lệ Lỗi HTTP</div>
                  <div className="font-mono font-bold text-white mt-0.5 flex items-center gap-1">
                    <span>{metrics.errors.errorRatePercent}%</span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      (2xx: {metrics.errors.statusCounts.s2xx}, 3xx: {metrics.errors.statusCounts.s3xx})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Slowest Routes Breakdown */}
            <div className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2">
              <div className="text-xs font-bold text-slate-200 flex items-center justify-between">
                <span>Top API Routes &amp; Độ trễ Percentile (P50 / P95)</span>
                <span className="text-[10px] text-slate-400 font-mono">Sliding window 1,000 samples</span>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {metrics.latency.slowestRoutes.length === 0 ? (
                  <div className="text-xs text-slate-500 py-3 text-center">Chưa có đủ mẫu yêu cầu</div>
                ) : (
                  metrics.latency.slowestRoutes.map((r, i) => (
                    <div
                      key={r.route + i}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs gap-2"
                    >
                      <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-200">
                        {r.route}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                        <span className="text-slate-400 text-[10px]">({r.count} reqs)</span>
                        <span className="text-cyan-400 font-bold">P50: {r.p50}ms</span>
                        <span className="text-amber-400 font-bold">P95: {r.p95}ms</span>
                        <span className="text-slate-400 text-[10px]">Avg: {r.avg}ms</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
};
