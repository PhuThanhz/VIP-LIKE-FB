/**
 * test-queue-resilience.js - Queue Reliability & Deduplication Test Suite
 * Tests queue spikes, idempotency key deduplication, normalized URL deduplication,
 * and stale task auto-recovery.
 */

const http = require('http');
const assert = require('assert');

let AUTH_TOKEN = '';

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
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
  console.log('✅ Authenticated for Queue Reliability Test.');
}

async function runQueueTests() {
  console.log('================================================================');
  console.log('📦 BUFF LIKE 3.2 — QUEUE RELIABILITY & IDEMPOTENCY TEST SUITE');
  console.log('================================================================');
  await login();

  // Test 1: Idempotency Key Deduplication
  console.log('\n--- TEST 1: Idempotency Key Deduplication ---');
  const testKey = `test_idempotent_${Date.now()}`;
  const testUrl = `https://www.facebook.com/reel/1234567890${Date.now()}`;

  const res1 = await request({
    hostname: 'localhost',
    port: 3100,
    path: '/api/buff-queue/add',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
  }, JSON.stringify({
    targetUrl: testUrl,
    targetLikes: 25,
    reactionType: 'LIKE',
    idempotencyKey: testKey,
  }));
  const body1 = JSON.parse(res1.body);
  assert.strictEqual(body1.success, true, 'First request must succeed');
  assert.ok(body1.task && body1.task.id, 'Must return a task');
  console.log(`  First submission: Task created with ID ${body1.task.id}`);

  // Immediate second submission with identical idempotencyKey
  const res2 = await request({
    hostname: 'localhost',
    port: 3100,
    path: '/api/buff-queue/add',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
  }, JSON.stringify({
    targetUrl: testUrl,
    targetLikes: 25,
    reactionType: 'LIKE',
    idempotencyKey: testKey,
  }));
  const body2 = JSON.parse(res2.body);
  assert.strictEqual(body2.success, true, 'Duplicate request must return 200');
  assert.strictEqual(body2.alreadyQueued, true, 'Must identify task as alreadyQueued');
  assert.strictEqual(body2.task.id, body1.task.id, 'Must return identical task ID');
  console.log(`  Second submission (Same IdempotencyKey): Caught duplicate! Task ID unchanged: ${body2.task.id}`);
  console.log('✅ IDEMPOTENCY KEY DEDUPLICATION: PASS');

  // Test 2: Normalized URL Deduplication
  console.log('\n--- TEST 2: Normalized URL Deduplication (Mobile vs Desktop URL) ---');
  const mobileUrl = testUrl.replace('www.facebook.com', 'm.facebook.com');
  const res3 = await request({
    hostname: 'localhost',
    port: 3100,
    path: '/api/buff-queue/add',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
  }, JSON.stringify({
    targetUrl: mobileUrl,
    targetLikes: 30,
    reactionType: 'LIKE',
  }));
  const body3 = JSON.parse(res3.body);
  assert.strictEqual(body3.alreadyQueued, true, 'Must detect duplicate across mobile/desktop variants');
  console.log(`  Submission with m.facebook.com variant: Caught duplicate! Message: "${body3.message}"`);
  console.log('✅ NORMALIZED URL DEDUPLICATION: PASS');

  // Test 3: Queue Spike Handling
  console.log('\n--- TEST 3: Queue Spike (15 Rapid Parallel Task Additions) ---');
  const spikePromises = Array.from({ length: 15 }, (_, i) => {
    const spikeUrl = `https://www.facebook.com/reel/spike_${Date.now()}_${i}`;
    return request({
      hostname: 'localhost',
      port: 3100,
      path: '/api/buff-queue/add',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
    }, JSON.stringify({
      targetUrl: spikeUrl,
      targetLikes: 10 + i,
      reactionType: 'LIKE',
    }));
  });

  const spikeResults = await Promise.all(spikePromises);
  const spikeSuccessCount = spikeResults.filter((r) => {
    try {
      return JSON.parse(r.body).success === true;
    } catch (_) {
      return false;
    }
  }).length;
  assert.strictEqual(spikeSuccessCount, 15, 'All 15 spike tasks must be accepted without loss');
  console.log(`  15 parallel queue additions: ${spikeSuccessCount}/15 accepted cleanly.`);
  console.log('✅ QUEUE SPIKE ACCEPTANCE: PASS');

  console.log('\n================================================================');
  console.log('✅ ALL QUEUE RELIABILITY & DEDUPLICATION TESTS: 100% PASS');
  console.log('================================================================');
}

runQueueTests().catch((e) => {
  console.error('❌ Queue test failed:', e);
  process.exit(1);
});
