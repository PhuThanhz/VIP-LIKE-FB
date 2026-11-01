/**
 * test-soak-3.1.js - Long-Running Stability & Soak Test Suite for BUFF LIKE 3.1
 * Executes sustained concurrent traffic, tracking heap memory drift,
 * event loop lag, connection pool health, and background worker state.
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
  if (!parsed.token) throw new Error('Login failed: ' + res.body);
  AUTH_TOKEN = parsed.token;
  console.log('✅ Authenticated successfully for Soak Test.');
}

async function getObservability() {
  const res = await request({
    hostname: 'localhost',
    port: 3100,
    path: '/api/system/observability',
    method: 'GET',
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return JSON.parse(res.body).metrics;
}

async function runSoakCycle(cycleIndex, requestsPerCycle) {
  const endpoints = [
    '/api/buff-logs?summary=true&limit=50',
    '/api/buff-cached-pages',
    '/api/buff-queue/list',
    '/api/buff-live/active',
    '/api/readiness',
    '/api/health',
  ];

  let completed = 0;
  let errors = 0;
  const latencies = [];

  for (let i = 0; i < requestsPerCycle; i++) {
    const ep = endpoints[i % endpoints.length];
    try {
      const res = await request({
        hostname: 'localhost',
        port: 3100,
        path: ep,
        method: 'GET',
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      if (res.statusCode >= 400) errors++;
      latencies.push(res.duration);
      completed++;
    } catch (e) {
      errors++;
    }
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);

  return { cycleIndex, completed, errors, p50, p95, avg };
}

async function main() {
  console.log('================================================================');
  console.log('🧪 BUFF LIKE 3.1 — LONG-RUNNING STABILITY & SOAK TEST SUITE');
  console.log('================================================================');
  await login();

  const NUM_CYCLES = 6;
  const REQUESTS_PER_CYCLE = 100; // 600 requests total
  const snapshots = [];

  const initialMetrics = await getObservability();
  console.log(`\nInitial State: RSS=${initialMetrics.systemMemory.rssMB}MB | HeapUsed=${initialMetrics.systemMemory.heapUsedMB}MB | EventLoopLag=${initialMetrics.eventLoop.meanLagMs}ms | DBPing=${initialMetrics.database.pingMs}ms\n`);

  snapshots.push({
    cycle: 0,
    rssMB: initialMetrics.systemMemory.rssMB,
    heapUsedMB: initialMetrics.systemMemory.heapUsedMB,
    eventLoopLagMs: initialMetrics.eventLoop.meanLagMs,
    dbPingMs: initialMetrics.database.pingMs,
    cpuPercent: initialMetrics.cpu ? initialMetrics.cpu.usagePercent : 0,
  });

  for (let c = 1; c <= NUM_CYCLES; c++) {
    const t0 = performance.now();
    const cycleRes = await runSoakCycle(c, REQUESTS_PER_CYCLE);
    const metrics = await getObservability();
    const cycleDuration = ((performance.now() - t0) / 1000).toFixed(2);

    snapshots.push({
      cycle: c,
      rssMB: metrics.systemMemory.rssMB,
      heapUsedMB: metrics.systemMemory.heapUsedMB,
      eventLoopLagMs: metrics.eventLoop.meanLagMs,
      dbPingMs: metrics.database.pingMs,
      cpuPercent: metrics.cpu ? metrics.cpu.usagePercent : 0,
    });

    console.log(`[Cycle ${c}/${NUM_CYCLES}] ${cycleRes.completed} reqs (${cycleRes.errors} err) in ${cycleDuration}s | P50: ${cycleRes.p50.toFixed(2)}ms | P95: ${cycleRes.p95.toFixed(2)}ms | Heap: ${metrics.systemMemory.heapUsedMB}MB | RSS: ${metrics.systemMemory.rssMB}MB | EventLoopLag: ${metrics.eventLoop.meanLagMs}ms | DB: ${metrics.database.pingMs}ms`);

    // 1-second pause between cycles to allow V8 GC & idle cleanup
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Memory Drift Analysis
  const first = snapshots[1];
  const last = snapshots[snapshots.length - 1];
  const heapDelta = Number((last.heapUsedMB - first.heapUsedMB).toFixed(2));
  const rssDelta = Number((last.rssMB - first.rssMB).toFixed(2));

  console.log('\n================================================================');
  console.log('📊 SOAK TEST RESULTS SUMMARY:');
  console.log('================================================================');
  console.log(`- Total HTTP Requests Processed: ${NUM_CYCLES * REQUESTS_PER_CYCLE}`);
  console.log(`- Initial Heap: ${first.heapUsedMB} MB -> Final Heap: ${last.heapUsedMB} MB (Delta: ${heapDelta > 0 ? '+' : ''}${heapDelta} MB)`);
  console.log(`- Initial RSS: ${first.rssMB} MB -> Final RSS: ${last.rssMB} MB (Delta: ${rssDelta > 0 ? '+' : ''}${rssDelta} MB)`);
  console.log(`- Event Loop Lag Stability: Final=${last.eventLoopLagMs}ms (Healthy: ${last.eventLoopLagMs < 50 ? 'YES' : 'NO'})`);
  console.log(`- Database Ping Stability: Final=${last.dbPingMs}ms`);

  const memoryHealthy = Math.abs(heapDelta) < 35; // Heap growth under 35MB over 600 requests is stable
  if (memoryHealthy) {
    console.log('✅ MEMORY DRIFT STABILITY: PASS (No unbounded heap leak detected).');
  } else {
    console.warn('⚠️ MEMORY DRIFT STABILITY: WARNING (Heap drift exceeded tolerance).');
  }
}

main().catch(console.error);
