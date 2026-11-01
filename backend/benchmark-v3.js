/**
 * benchmark-v3.js - Automated Benchmark Suite for BUFF LIKE 3.0
 * Measures real database latencies, API round-trip percentiles (P50/P95/P99),
 * memory consumption, and event loop metrics.
 */

const http = require('http');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const db = require('./db');

function calculatePercentiles(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const avg = (sorted.reduce((a, b) => a + b, 0) / sorted.length);
  return {
    min: sorted[0].toFixed(2),
    p50: p50.toFixed(2),
    p95: p95.toFixed(2),
    p99: p99.toFixed(2),
    max: sorted[sorted.length - 1].toFixed(2),
    avg: avg.toFixed(2),
  };
}

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3100/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).token);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ username: 'huynhthanhphu', password: '123' }));
    req.end();
  });
}

async function measureEndpoint(token, path, iterations = 20) {
  const times = [];
  let payloadBytes = 0;

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await new Promise((resolve) => {
      http.get('http://localhost:3100' + path, {
        headers: { Authorization: 'Bearer ' + token },
      }, (res) => {
        let b = '';
        res.on('data', (chunk) => (b += chunk));
        res.on('end', () => {
          payloadBytes = Buffer.byteLength(b);
          resolve();
        });
      });
    });
    times.push(performance.now() - t0);
  }

  return {
    ...calculatePercentiles(times),
    payloadKB: (payloadBytes / 1024).toFixed(1),
  };
}

async function runBenchmark() {
  console.log('====================================================');
  console.log('🚀 BUFF LIKE 3.0 — AUTOMATED BENCHMARK SUITE');
  console.log('Timestamp:', new Date().toISOString());
  console.log('====================================================\n');

  // 1. Database Query Latency
  console.log('--- 1. DATABASE QUERY BENCHMARK ---');
  await db.testConnection();
  const pool = db.getPool();

  const dbQueries = [
    { name: 'buff_history (Covering Index, Limit 50)', sql: 'SELECT id, status, page_id, created_at FROM buff_history ORDER BY created_at DESC LIMIT 50' },
    { name: 'facebook_page_accesses (Active Profile Pages)', sql: 'SELECT page_id, page_name, personal_profile_id FROM facebook_page_accesses WHERE active = 1 LIMIT 50' },
    { name: 'buff_logs (Summary List, Limit 50)', sql: 'SELECT id, run_type, target_url, total_pages, success_count FROM buff_logs ORDER BY created_at DESC LIMIT 50' },
  ];

  const dbResults = [];
  for (const q of dbQueries) {
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await pool.execute(q.sql);
      times.push(performance.now() - t0);
    }
    const pct = calculatePercentiles(times);
    console.log(`- ${q.name}: P50=${pct.p50}ms | P95=${pct.p95}ms | Avg=${pct.avg}ms`);
    dbResults.push({ name: q.name, ...pct });
  }

  // 2. Event Loop Lag
  console.log('\n--- 2. NODE.JS EVENT LOOP BENCHMARK ---');
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  await new Promise((r) => setTimeout(r, 500));
  h.disable();
  const eventLoopLagMs = (h.mean / 1e6).toFixed(3);
  const eventLoopP99Ms = (h.p99 / 1e6).toFixed(3);
  console.log(`Event Loop Lag Mean: ${eventLoopLagMs}ms | P99: ${eventLoopP99Ms}ms`);

  // 3. Process Memory
  console.log('\n--- 3. MEMORY CONSUMPTION ---');
  const mem = process.memoryUsage();
  console.log(`RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);

  // 4. API Response Time & Percentiles
  console.log('\n--- 4. API LATENCY & PERCENTILES (20 Iterations) ---');
  const token = await getAuthToken();
  const endpoints = [
    { name: 'GET /api/buff-logs?summary=true&limit=50', path: '/api/buff-logs?summary=true&limit=50' },
    { name: 'GET /api/buff-cached-pages', path: '/api/buff-cached-pages' },
    { name: 'GET /api/buff-live/active', path: '/api/buff-live/active' },
    { name: 'GET /api/buff-logs/:id', path: '/api/buff-logs/log_1793547229167_1_tv6dpp1' },
  ];

  const apiResults = [];
  for (const ep of endpoints) {
    const res = await measureEndpoint(token, ep.path, 20);
    console.log(`- ${ep.name}: P50=${res.p50}ms | P95=${res.p95}ms | P99=${res.p99}ms | Avg=${res.avg}ms | Size=${res.payloadKB} KB`);
    apiResults.push({ name: ep.name, ...res });
  }

  console.log('\n✅ Benchmark suite completed successfully.');
  return { dbResults, eventLoop: { meanMs: eventLoopLagMs, p99Ms: eventLoopP99Ms }, mem, apiResults };
}

if (require.main === module) {
  runBenchmark().then(() => process.exit(0)).catch((e) => {
    console.error('Benchmark failed:', e);
    process.exit(1);
  });
}

module.exports = { runBenchmark };
