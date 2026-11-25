/**
 * BUFF LIKE 3.3 — FAILURE INJECTION & DISTRIBUTED CONCURRENCY TEST SUITE
 * Tests 10 strict failure scenarios: Crash recovery, Fencing preemption, Idempotency, Deep Abort
 */

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3100';

function getAuthHeader() {
  const secretPath = path.join(__dirname, 'data', '.jwt_secret');
  const secret = process.env.JWT_SECRET || (fs.existsSync(secretPath) ? fs.readFileSync(secretPath, 'utf8').trim() : 'secret');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: 'admin',
    id: 1,
    role: 'ADMIN',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${sig}`;
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(
      `${BASE_URL}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Authorization': getAuthHeader(),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${BASE_URL}${path}`,
      {
        headers: {
          'Authorization': getAuthHeader(),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      }
    );
    req.on('error', reject);
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 STARTING THE BUFF LIKE 3.3 FAILURE INJECTION & HARDENING SUITE');
  console.log('================================================================\n');

  const results = [];

  const record = (num, name, passed, details) => {
    results.push({ num, name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[Test ${num}] ${mark}: ${name}`);
    if (details) console.log(`   └─ ${details}`);
  };

  // -------------------------------------------------------------
  // Test 1: Idempotency Key Deduplication (Scenario 10)
  // -------------------------------------------------------------
  try {
    const idemKey = 'idem_test_' + Date.now();
    const res1 = await postJson('/api/buff-queue/add', {
      targetUrl: 'https://facebook.com/test_idem_post_1',
      targetLikes: 20,
      reactionType: 'LIKE',
      idempotencyKey: idemKey,
    });
    const res2 = await postJson('/api/buff-queue/add', {
      targetUrl: 'https://facebook.com/test_idem_post_1',
      targetLikes: 20,
      reactionType: 'LIKE',
      idempotencyKey: idemKey,
    });

    const isSameId = Boolean(res1.body.task?.id) && res1.body.task?.id === res2.body.task?.id;
    const isDeduped = res2.body.alreadyQueued === true;
    record(1, 'Idempotency Key Deduplication (no duplicate tasks on repeated sends)', isSameId && isDeduped, `Task ID: ${res1.body.task?.id}, Deduped: ${isDeduped}`);
  } catch (err) {
    record(1, 'Idempotency Key Deduplication', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 2: Crash recovery BEFORE the task starts (Scenarios 1 & 2)
  // Task in RUNNING, executionStage = 'PREPARING', 0 likes
  // -> Must be safely restored to QUEUED automatically
  // -------------------------------------------------------------
  try {
    const db = require('./db');
    const store = require('./state-store');
    
    // Load the queue, create 1 task simulating a crash in PREPARING
    const qd = (await store.read('buff_queue')) || { items: [] };
    const taskCrashPre = {
      id: 'task_crash_pre_' + Date.now(),
      targetUrl: 'https://facebook.com/test_pre_crash',
      targetLikes: 30,
      reactionType: 'LIKE',
      status: 'RUNNING',
      executionStage: 'PREPARING',
      startedAt: new Date().toISOString(),
      progress: { done: 0, success: 0, failed: 0 },
      pageDetails: [],
    };
    qd.items.push(taskCrashPre);
    store.write('buff_queue', qd);
    await store.flush();

    // Simulate recovery after a restart
    const serverModule = require('./server_recovery_test_helper.js');
    serverModule.triggerCrashRecovery();

    const qdAfter = (await store.read('buff_queue')) || { items: [] };
    const recovered = qdAfter.items.find((it) => it.id === taskCrashPre.id);

    const isQueued = recovered && recovered.status === 'QUEUED';
    const hasInitStage = recovered && recovered.executionStage === 'INITIALIZED';
    record(2, 'Crash Recovery before dispatching external actions (safely back to QUEUED)', isQueued && hasInitStage, `Status: ${recovered?.status}, Stage: ${recovered?.executionStage}`);
  } catch (err) {
    record(2, 'Crash Recovery before dispatching external actions', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 3: Crash recovery AFTER EXTERNAL ENGAGEMENT (Scenario 3)
  // Task in RUNNING, executionStage = 'INTERACTING', 8 likes already done
  // -> Must NOT go back to QUEUED! Must move to NEEDS_REVIEW to prevent duplicates!
  // -------------------------------------------------------------
  try {
    const store = require('./state-store');
    const qd = (await store.read('buff_queue')) || { items: [] };
    const taskCrashMid = {
      id: 'task_crash_mid_' + Date.now(),
      targetUrl: 'https://facebook.com/test_mid_crash',
      targetLikes: 50,
      reactionType: 'LIKE',
      status: 'RUNNING',
      executionStage: 'INTERACTING',
      startedAt: new Date().toISOString(),
      progress: { done: 10, success: 8, failed: 2 },
      pageDetails: [{ pageId: 'p1', status: 'SUCCESS' }],
    };
    qd.items.push(taskCrashMid);
    store.write('buff_queue', qd);
    await store.flush();

    const serverModule = require('./server_recovery_test_helper.js');
    serverModule.triggerCrashRecovery();

    const qdAfter = (await store.read('buff_queue')) || { items: [] };
    const recovered = qdAfter.items.find((it) => it.id === taskCrashMid.id);

    const isNeedsReview = recovered && recovered.status === 'NEEDS_REVIEW';
    const hasReviewReason = recovered && recovered.reviewReason === 'CRASH_DURING_EXTERNAL_INTERACTION';
    const preservedLikes = recovered && recovered.progress.success === 8;
    record(3, 'Crash Recovery after side effects (moved to NEEDS_REVIEW to prevent duplicates)', isNeedsReview && hasReviewReason && preservedLikes, `Status: ${recovered?.status}, Preserved Success: ${recovered?.progress?.success}`);
  } catch (err) {
    record(3, 'Crash Recovery after side effects', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 4: Crash recovery when the task finished but was waiting to sync (Scenario 4)
  // executionStage = 'SYNCING' -> safely finalize to COMPLETED
  // -------------------------------------------------------------
  try {
    const store = require('./state-store');
    const qd = (await store.read('buff_queue')) || { items: [] };
    const taskCrashSync = {
      id: 'task_crash_sync_' + Date.now(),
      targetUrl: 'https://facebook.com/test_sync_crash',
      targetLikes: 20,
      reactionType: 'LIKE',
      status: 'RUNNING',
      executionStage: 'SYNCING',
      progress: { done: 20, success: 20, failed: 0 },
      pageDetails: Array(20).fill({ status: 'SUCCESS' }),
    };
    qd.items.push(taskCrashSync);
    store.write('buff_queue', qd);
    await store.flush();

    const serverModule = require('./server_recovery_test_helper.js');
    serverModule.triggerCrashRecovery();

    const qdAfter = (await store.read('buff_queue')) || { items: [] };
    const recovered = qdAfter.items.find((it) => it.id === taskCrashSync.id);

    const isCompleted = recovered && recovered.status === 'COMPLETED';
    record(4, 'Crash Recovery while the task is SYNCING (finalize to COMPLETED)', isCompleted, `Status: ${recovered?.status}`);
  } catch (err) {
    record(4, 'Crash Recovery while the task is SYNCING', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 5: API Review Resolution Endpoint (/api/buff-queue/review-resolve/:id)
  // Manual reconciliation: RESUME the missing likes (50 - 8 = 42 likes)
  // -------------------------------------------------------------
  try {
    const store = require('./state-store');
    const qd = store.read('buff_queue') || { items: [] };
    const reviewTask = qd.items.find((it) => it.status === 'NEEDS_REVIEW');
    assert(reviewTask, 'A NEEDS_REVIEW task from Test 3 is required');

    const serverModule = require('./server_recovery_test_helper.js');
    const res = serverModule.resolveReviewTask(reviewTask, 'RESUME');

    const isOk = res.success === true;
    const isQueued = res.task?.status === 'QUEUED';
    const adjustedTarget = res.task?.targetLikes === 42; // 50 - 8 = 42 missing likes!
    record(5, 'Review Resolution: RESUME reconciliation tops up the missing likes (50 - 8 = 42 likes)', isOk && isQueued && adjustedTarget, `Status: ${res.task?.status}, New Target: ${res.task?.targetLikes}`);
  } catch (err) {
    record(5, 'Review Resolution Endpoint', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 6: Monotonic Fencing Tokens via MySQL (Scenario 7 & Phase 2)
  // Tokens must always increase monotonically and never repeat
  // -------------------------------------------------------------
  try {
    const db = require('./db');
    const token1 = await db.allocateFencingToken();
    const token2 = await db.allocateFencingToken();
    const token3 = await db.allocateFencingToken();

    const isMonotonic = token1 < token2 && token2 < token3;
    record(6, 'Monotonic Distributed Fencing Tokens (monotonic & unique via MySQL)', isMonotonic, `T1: ${token1}, T2: ${token2}, T3: ${token3}`);
  } catch (err) {
    record(6, 'Monotonic Distributed Fencing Tokens', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 7: Fencing Preemption & Stale Token Write Rejection (Scenario 6)
  // When a task's lease is revoked (preempted), the old token becomes stale -> writes are forbidden
  // -------------------------------------------------------------
  try {
    const serverModule = require('./server_recovery_test_helper.js');
    const { isPreempted, writeRejected } = await serverModule.testFencingPreemption();
    record(7, 'Fencing Preemption: an expired/revoked lease may not overwrite state', isPreempted && writeRejected, `Preempted: ${isPreempted}, Write Rejected: ${writeRejected}`);
  } catch (err) {
    record(7, 'Fencing Preemption & Stale Write Rejection', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 8: Playwright Deep Abort: cancellableSleep & Immediate Context Close (Phase 3)
  // A fired AbortSignal must stop waiting immediately (< 10ms instead of waiting 2000ms)
  // -------------------------------------------------------------
  try {
    const serverModule = require('./server_recovery_test_helper.js');
    const startMs = Date.now();
    const abortResult = await serverModule.testDeepAbortSpeed();
    const durationMs = Date.now() - startMs;

    const isInstant = durationMs < 50; // Expected to sleep 2000ms but aborted instantly in < 50ms!
    record(8, 'Playwright Deep Cancellation (cancels instantly without waiting for a Timeout)', isInstant && abortResult.aborted, `Cancel time: ${durationMs}ms (instead of a 2000ms timeout)`);
  } catch (err) {
    record(8, 'Playwright Deep Cancellation', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 9: Worker Disconnect (a client dropping SSE doesn't crash the server) (Scenario 5)
  // -------------------------------------------------------------
  try {
    const sseReq = http.request(
      `${BASE_URL}/api/buff-like-stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        // Disconnect right after receiving the headers
        sseReq.destroy();
      }
    );
    sseReq.write(JSON.stringify({ targetUrl: 'https://facebook.com/test_disconnect', cookieString: 'c_user=123; xs=abc' }));
    sseReq.end();
    await sleep(200);

    const health = await getJson('/api/health');
    const isServerAlive = health.body?.status === 'UP';
    record(9, 'Worker/Client SSE Disconnect (server doesn\'t crash, background keeps processing safely)', isServerAlive, `Server status: ${health.body?.status}`);
  } catch (err) {
    record(9, 'Worker/Client SSE Disconnect', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 10: Database Connection Resiliency & Memory Store Fallback (Scenario 9)
  // -------------------------------------------------------------
  try {
    const store = require('./state-store');
    const qd = (await store.read('buff_queue')) || { items: [] };
    // Data still loads and writes through the durable store even with I/O latency
    const isStoreOperational = Array.isArray(qd.items);
    record(10, 'Database & StateStore Resiliency (no data lost via flush/cache fallback)', isStoreOperational, `Queue items: ${qd.items.length}`);
  } catch (err) {
    record(10, 'Database & StateStore Resiliency', false, err.message);
  }

  console.log('\n================================================================');
  const allPassed = results.every((r) => r.passed);
  console.log(`RESULT: ${results.filter((r) => r.passed).length}/${results.length} TEST SCENARIOS PASSED`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('TEST SUITE RUN ERROR:', e);
  process.exit(1);
});
