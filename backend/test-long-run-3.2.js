/**
 * test-long-run-3.2.js - Sustained Long-Running Traffic & Memory Drift Analyzer
 * Generates sustained continuous traffic across all system endpoints,
 * collecting high-precision telemetry snapshots at regular intervals
 * to measure memory drift, event loop stability, and queue health.
 */

const http = require('http');
const { performance } = require('perf_hooks');

const BASE_URL = 'http://localhost:3100';
let AUTH_TOKEN = '';

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const duration = performance.now() - t0;
        resolve({ statusCode: res.statusCode, body, duration });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  const res = await request({
    hostname: 'localhost',
    port: 3100,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, JSON.stringify({ username: 'huynhthanhphu', password: '123' }));
  const parsed = JSON.parse(res.body);
  AUTH_TOKEN = parsed.token;
  console.log('✅ Authenticated successfully for Long-Running Test.');
}

async function fetchTelemetry() {
  const res = await request({
    hostname: 'localhost',
    port: 3100,
    path: '/api/system/observability',
    method: 'GET',
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return JSON.parse(res.body).metrics;
}

async function main() {
  console.log('================================================================');
  console.log('⏳ BUFF LIKE 3.2 — SUSTAINED LONG-RUNNING STABILITY SUITE');
  console.log('================================================================');
  await login();

  const endpoints = [
    '/api/buff-logs?summary=true&limit=50',
    '/api/buff-cached-pages',
    '/api/buff-queue/list',
    '/api/buff-live/active',
    '/api/readiness',
    '/api/health',
    '/api/system/observability',
  ];

  const BATCH_SIZE = 100;
  const TOTAL_BATCHES = 12; // 1,200 requests sustained
  const snapshots = [];

  const tStart = performance.now();
  const initMetrics = await fetchTelemetry();
  console.log(`Initial State: RSS=${initMetrics.systemMemory.rssMB}MB | Heap=${initMetrics.systemMemory.heapUsedMB}MB | CPU=${initMetrics.cpu?.usagePercent || 0}% | EventLoopLag=${initMetrics.eventLoop.meanLagMs}ms | DBPing=${initMetrics.database.pingMs}ms\n`);

  snapshots.push({
    requestCount: 0,
    elapsedSec: 0,
    rssMB: initMetrics.systemMemory.rssMB,
    heapUsedMB: initMetrics.systemMemory.heapUsedMB,
    cpuPercent: initMetrics.cpu?.usagePercent || 0,
    eventLoopLagMs: initMetrics.eventLoop.meanLagMs,
    dbPingMs: initMetrics.database.pingMs,
    queueDepth: initMetrics.queueDepth?.queued || 0,
  });

  let totalErrors = 0;
  let totalRequests = 0;

  for (let b = 1; b <= TOTAL_BATCHES; b++) {
    const tBatchStart = performance.now();
    const promises = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      const ep = endpoints[(b * BATCH_SIZE + i) % endpoints.length];
      promises.push(
        request({
          hostname: 'localhost',
          port: 3100,
          path: ep,
          method: 'GET',
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        })
      );
    }

    const batchRes = await Promise.all(promises);
    totalRequests += BATCH_SIZE;

    const batchErrors = batchRes.filter((r) => r.statusCode >= 400).length;
    totalErrors += batchErrors;

    const metrics = await fetchTelemetry();
    const elapsedTotalSec = Number(((performance.now() - tStart) / 1000).toFixed(1));
    const batchDurationMs = Number((performance.now() - tBatchStart).toFixed(1));

    snapshots.push({
      requestCount: totalRequests,
      elapsedSec: elapsedTotalSec,
      rssMB: metrics.systemMemory.rssMB,
      heapUsedMB: metrics.systemMemory.heapUsedMB,
      cpuPercent: metrics.cpu?.usagePercent || 0,
      eventLoopLagMs: metrics.eventLoop.meanLagMs,
      dbPingMs: metrics.database.pingMs,
      queueDepth: metrics.queueDepth?.queued || 0,
    });

    console.log(`[Batch ${b}/${TOTAL_BATCHES} | T=${elapsedTotalSec}s] ${BATCH_SIZE} reqs in ${batchDurationMs}ms | Heap: ${metrics.systemMemory.heapUsedMB}MB | RSS: ${metrics.systemMemory.rssMB}MB | CPU: ${metrics.cpu?.usagePercent || 0}% | EventLoopLag: ${metrics.eventLoop.meanLagMs}ms | DB: ${metrics.database.pingMs}ms | Errors: ${batchErrors}`);

    // Small delay between batches to allow V8 GC cycles
    await new Promise((r) => setTimeout(r, 600));
  }

  // Linear Regression on Heap Usage to calculate Memory Leak Slope (MB/1000 requests)
  const n = snapshots.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  snapshots.forEach((s) => {
    sumX += s.requestCount;
    sumY += s.heapUsedMB;
    sumXY += s.requestCount * s.heapUsedMB;
    sumXX += s.requestCount * s.requestCount;
  });
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const driftPer1000Reqs = Number((slope * 1000).toFixed(2));

  console.log('\n================================================================');
  console.log('📈 SUSTAINED STABILITY ANALYSIS RESULTS:');
  console.log('================================================================');
  console.log(`- Total Requests Completed: ${totalRequests}`);
  console.log(`- Total HTTP Failures: ${totalErrors} (Error Rate: ${((totalErrors / totalRequests) * 100).toFixed(2)}%)`);
  console.log(`- Initial Heap: ${snapshots[0].heapUsedMB} MB -> Final Heap: ${snapshots[snapshots.length - 1].heapUsedMB} MB`);
  console.log(`- Initial RSS: ${snapshots[0].rssMB} MB -> Final RSS: ${snapshots[snapshots.length - 1].rssMB} MB`);
  console.log(`- Calculated Memory Drift Slope: ${driftPer1000Reqs > 0 ? '+' : ''}${driftPer1000Reqs} MB / 1,000 requests`);
  console.log(`- Event Loop Lag: Mean=${snapshots[snapshots.length - 1].eventLoopLagMs}ms (Healthy: ${snapshots[snapshots.length - 1].eventLoopLagMs < 50 ? 'YES' : 'NO'})`);
  console.log(`- Database Ping Roundtrip: Final=${snapshots[snapshots.length - 1].dbPingMs}ms`);

  const stable = Math.abs(driftPer1000Reqs) < 20.0;
  if (stable) {
    console.log('✅ LONG-RUNNING STABILITY: PASS (Memory slope indicates stable plateau, no leak).');
  } else {
    console.warn('⚠️ LONG-RUNNING STABILITY: WARNING (Drift slope indicates possible retention).');
  }
}

main().catch(console.error);
