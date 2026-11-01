/**
 * telemetry.js - Real-Time Observability Engine for BUFF LIKE 3.0
 * Provides high-precision latency metrics (P50/P95/P99), request throughput,
 * event loop lag tracking, memory metrics, and health probes.
 */

const { performance, monitorEventLoopDelay } = require('perf_hooks');
const os = require('os');

class TelemetryEngine {
  constructor(options = {}) {
    this.maxWindowSize = options.maxWindowSize || 1000;
    this.latencies = [];
    this.routeLatencies = new Map();
    this.statusCounts = { total: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
    this.startTime = Date.now();
    this.lastMinuteRequests = [];

    // Initialize Event Loop Lag Monitor
    this.eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopMonitor.enable();

    // CPU Usage Tracking
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleTime = performance.now();
    this.currentCpuPercent = 0;
    this.cpuCores = os.cpus().length;

    // Context references injected by server.js
    this.serverContext = {
      busyBuffLanes: null,
      buffLaneWaiters: null,
      activeLiveBuffSessions: null,
      activeBuffTaskIds: null,
      db: null,
      getQueueStats: null,
      getWorkerHealth: null,
    };
  }

  sampleCpu() {
    const elapsedMs = performance.now() - this.lastCpuSampleTime;
    if (elapsedMs < 100) return this.currentCpuPercent;
    const diff = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleTime = performance.now();
    const totalCpuTimeMicroSec = diff.user + diff.system;
    const elapsedMicroSec = elapsedMs * 1000;
    const rawPercent = (totalCpuTimeMicroSec / elapsedMicroSec) * 100;
    // Normalize by core count to give total system relative CPU
    const normalizedPercent = Math.min(100, Math.max(0, rawPercent / (this.cpuCores || 1)));
    this.currentCpuPercent = Number(normalizedPercent.toFixed(1));
    return this.currentCpuPercent;
  }

  setContext(context) {
    this.serverContext = { ...this.serverContext, ...context };
  }

  middleware() {
    return (req, res, next) => {
      const start = performance.now();
      const now = Date.now();

      // Clean up requests older than 60s for RPM calculation
      this.lastMinuteRequests = this.lastMinuteRequests.filter((t) => now - t < 60000);
      this.lastMinuteRequests.push(now);
      this.statusCounts.total++;

      res.on('finish', () => {
        const duration = performance.now() - start;
        this.recordRequest(req.method, req.route ? req.route.path : req.path, res.statusCode, duration);
      });

      next();
    };
  }

  recordRequest(method, path, statusCode, durationMs) {
    // Sliding window of total latencies
    if (this.latencies.length >= this.maxWindowSize) {
      this.latencies.shift();
    }
    this.latencies.push(durationMs);

    // Group by route
    const routeKey = `${method} ${path}`;
    if (!this.routeLatencies.has(routeKey)) {
      this.routeLatencies.set(routeKey, []);
    }
    const routeList = this.routeLatencies.get(routeKey);
    if (routeList.length >= 200) routeList.shift();
    routeList.push(durationMs);

    // Status counts
    if (statusCode >= 500) this.statusCounts.s5xx++;
    else if (statusCode >= 400) this.statusCounts.s4xx++;
    else if (statusCode >= 300) this.statusCounts.s3xx++;
    else if (statusCode >= 200) this.statusCounts.s2xx++;
  }

  calcPercentiles(arr) {
    if (!arr || arr.length === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 };
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return {
      p50: Number(p50.toFixed(2)),
      p95: Number(p95.toFixed(2)),
      p99: Number(p99.toFixed(2)),
      min: Number(sorted[0].toFixed(2)),
      max: Number(sorted[sorted.length - 1].toFixed(2)),
      avg: Number(avg.toFixed(2)),
      count: sorted.length,
    };
  }

  async getMetrics() {
    const mem = process.memoryUsage();
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);

    // Event loop lag (convert nanoseconds to milliseconds)
    const eventLoopLagMeanMs = Number((this.eventLoopMonitor.mean / 1e6).toFixed(2));
    const eventLoopLagP99Ms = Number((this.eventLoopMonitor.p99 / 1e6).toFixed(2));

    // Request throughput
    const rpm = this.lastMinuteRequests.length;
    const rps = Number((rpm / 60).toFixed(2));

    // Error rate
    const totalRequests = this.statusCounts.total || 1;
    const errorCount = this.statusCounts.s4xx + this.statusCounts.s5xx;
    const errorRatePercent = Number(((errorCount / totalRequests) * 100).toFixed(2));

    // Test DB ping latency
    let dbPingMs = null;
    let dbStatus = 'UNKNOWN';
    if (this.serverContext.db) {
      try {
        const pool = this.serverContext.db.getPool();
        if (pool) {
          const t0 = performance.now();
          await pool.execute('SELECT 1');
          dbPingMs = Number((performance.now() - t0).toFixed(2));
          dbStatus = 'CONNECTED';
        }
      } catch (err) {
        dbStatus = 'ERROR: ' + err.message;
      }
    }

    // Top Slowest Routes
    const topRoutes = [];
    for (const [route, times] of this.routeLatencies.entries()) {
      topRoutes.push({
        route,
        ...this.calcPercentiles(times),
      });
    }
    topRoutes.sort((a, b) => b.p95 - a.p95);

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: uptimeSec,
      throughput: {
        requestsPerSecond: rps,
        requestsPerMinute: rpm,
        totalRequests: this.statusCounts.total,
      },
      latency: {
        global: this.calcPercentiles(this.latencies),
        slowestRoutes: topRoutes.slice(0, 5),
      },
      errors: {
        errorRatePercent,
        statusCounts: this.statusCounts,
      },
      eventLoop: {
        meanLagMs: eventLoopLagMeanMs,
        p99LagMs: eventLoopLagP99Ms,
        healthy: eventLoopLagMeanMs < 50,
      },
      systemMemory: {
        rssMB: Number((mem.rss / 1024 / 1024).toFixed(2)),
        heapTotalMB: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
        heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
        externalMB: Number((mem.external / 1024 / 1024).toFixed(2)),
      },
      cpu: {
        usagePercent: this.sampleCpu(),
        cores: this.cpuCores,
      },
      queueDepth: this.serverContext.getQueueStats ? this.serverContext.getQueueStats() : { total: 0, queued: 0, running: 0, completed: 0, partial: 0, deadLetter: 0 },
      workerHealth: this.serverContext.getWorkerHealth ? this.serverContext.getWorkerHealth() : { status: 'UNKNOWN' },
      database: {
        status: dbStatus,
        pingMs: dbPingMs,
      },
      concurrencyEngine: {
        activeBuffLanes: this.serverContext.busyBuffLanes ? this.serverContext.busyBuffLanes.size : 0,
        laneWaiters: this.serverContext.buffLaneWaiters ? this.serverContext.buffLaneWaiters.length : 0,
        activeTasksCount: this.serverContext.activeBuffTaskIds ? this.serverContext.activeBuffTaskIds.size : 0,
        activeSessionsCount: this.serverContext.activeLiveBuffSessions ? this.serverContext.activeLiveBuffSessions.size : 0,
      },
    };
  }
}

const telemetry = new TelemetryEngine();
module.exports = telemetry;
