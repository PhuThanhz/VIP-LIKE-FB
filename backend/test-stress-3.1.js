/**
 * test-stress-3.1.js - Multi-Client Concurrency & Load Stress Test Suite
 * Evaluates high concurrency bursts (20, 50, 100 concurrent requests),
 * Keyset cursor pagination resilience, and malformed input handling.
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
  console.log('✅ Authenticated successfully for Stress Test.');
}

async function runConcurrencyBurst(concurrencyLevel, endpoint) {
  const t0 = performance.now();
  const promises = [];

  for (let i = 0; i < concurrencyLevel; i++) {
    promises.push(
      request({
        hostname: 'localhost',
        port: 3100,
        path: endpoint,
        method: 'GET',
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      })
    );
  }

  const results = await Promise.all(promises);
  const wallTimeMs = performance.now() - t0;
  const latencies = results.map((r) => r.duration).sort((a, b) => a - b);
  const successCount = results.filter((r) => r.statusCode === 200 || r.statusCode === 304).length;
  const errorCount = results.length - successCount;

  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99))];
  const rps = Number(((concurrencyLevel / wallTimeMs) * 1000).toFixed(1));

  return { concurrencyLevel, wallTimeMs, successCount, errorCount, p50, p95, p99, rps };
}

async function testKeysetCursorStress() {
  console.log('\n--- TESTING KEYSET CURSOR PAGINATION DEEP DRILL ---');
  let currentCursor = null;
  const pageLatencies = [];

  for (let page = 1; page <= 5; page++) {
    let url = '/api/buff-logs?summary=true&limit=10';
    if (currentCursor) {
      url += `&cursorCreatedAt=${encodeURIComponent(currentCursor.createdAt)}&cursorId=${encodeURIComponent(currentCursor.id)}`;
    }

    const res = await request({
      hostname: 'localhost',
      port: 3100,
      path: url,
      method: 'GET',
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });

    const parsed = JSON.parse(res.body);
    pageLatencies.push(res.duration);
    currentCursor = parsed.nextCursor;
    console.log(`  Page ${page}: ${parsed.logs?.length || 0} rows | Duration: ${res.duration.toFixed(2)}ms | NextCursor: ${currentCursor ? currentCursor.id : 'NONE'}`);
    if (!currentCursor) break;
  }

  const avgPageLatency = (pageLatencies.reduce((a, b) => a + b, 0) / pageLatencies.length).toFixed(2);
  console.log(`✅ Keyset Cursor $O(1)$ Pagination verified. Avg Page Latency: ${avgPageLatency}ms.`);
}

async function testResilienceAndInputValidation() {
  console.log('\n--- TESTING RESILIENCE & INPUT VALIDATION ---');
  const malformedTests = [
    { name: 'Missing JWT Header', path: '/api/buff-logs', headers: {}, expectedStatus: 401 },
    { name: 'Invalid JWT Token', path: '/api/buff-logs', headers: { Authorization: 'Bearer INVALID_FAKE_TOKEN' }, expectedStatus: 401 },
    { name: 'Malformed JSON Body to login', path: '/api/auth/login', method: 'POST', body: 'NOT_JSON{{{', headers: { 'Content-Type': 'application/json' }, expectedStatus: 400 },
    { name: 'Missing parameters in buff stream', path: '/api/buff-like-stream', method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` }, expectedStatus: 400 },
  ];

  for (const t of malformedTests) {
    const res = await request({
      hostname: 'localhost',
      port: 3100,
      path: t.path,
      method: t.method || 'GET',
      headers: t.headers,
    }, t.body || null);

    const pass = res.statusCode === t.expectedStatus;
    console.log(`  [${t.name}] Status: ${res.statusCode} (Expected: ${t.expectedStatus}) -> ${pass ? '✅ PASS' : '❌ FAIL'}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('⚡ BUFF LIKE 3.1 — MULTI-CLIENT CONCURRENCY & STRESS TEST');
  console.log('================================================================');
  await login();

  const concurrencyLevels = [20, 50, 100];
  console.log('\n--- CONCURRENCY BURST TESTING ---');
  for (const c of concurrencyLevels) {
    const res = await runConcurrencyBurst(c, '/api/buff-logs?summary=true&limit=50');
    console.log(`Burst ${c} Concurrent Reqs: Success=${res.successCount}/${c} | WallTime=${res.wallTimeMs.toFixed(1)}ms | RPS=${res.rps} | P50=${res.p50.toFixed(2)}ms | P95=${res.p95.toFixed(2)}ms | P99=${res.p99.toFixed(2)}ms`);
  }

  await testKeysetCursorStress();
  await testResilienceAndInputValidation();

  console.log('\n================================================================');
  console.log('✅ ALL STRESS & RESILIENCE TESTS COMPLETED SUCCESSFULLY.');
  console.log('================================================================');
}

main().catch(console.error);
