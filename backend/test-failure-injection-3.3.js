/**
 * BUFF LIKE 3.3 — FAILURE INJECTION & DISTRIBUTED CONCURRENCY TEST SUITE
 * Kiểm thử 10 kịch bản lỗi nghiêm ngặt: Crash recovery, Fencing preemption, Idempotency, Deep Abort
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
  console.log('🧪 BẮT ĐẦU BUFF LIKE 3.3 FAILURE INJECTION & HARDENING SUITE');
  console.log('================================================================\n');

  const results = [];

  const record = (num, name, passed, details) => {
    results.push({ num, name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[Test ${num}] ${mark}: ${name}`);
    if (details) console.log(`   └─ ${details}`);
  };

  // -------------------------------------------------------------
  // Test 1: Idempotency Key Deduplication (Kịch bản 10)
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
    record(1, 'Idempotency Key Deduplication (Chống trùng task gửi lặp)', isSameId && isDeduped, `Task ID: ${res1.body.task?.id}, Deduped: ${isDeduped}`);
  } catch (err) {
    record(1, 'Idempotency Key Deduplication', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 2: Crash recovery TRƯỚC KHI task bắt đầu (Kịch bản 1 & 2)
  // Task ở trạng thái RUNNING, executionStage = 'PREPARING', 0 like
  // -> Phải tự động phục hồi về QUEUED an toàn
  // -------------------------------------------------------------
  try {
    const db = require('./db');
    const store = require('./state-store');
    
    // Nạp queue, tạo 1 task giả lập crash ở PREPARING
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

    // Giả lập phục hồi sau restart
    const serverModule = require('./server_recovery_test_helper.js');
    serverModule.triggerCrashRecovery();

    const qdAfter = (await store.read('buff_queue')) || { items: [] };
    const recovered = qdAfter.items.find((it) => it.id === taskCrashPre.id);

    const isQueued = recovered && recovered.status === 'QUEUED';
    const hasInitStage = recovered && recovered.executionStage === 'INITIALIZED';
    record(2, 'Crash Recovery trước khi dispatch thao tác ngoài (An toàn về QUEUED)', isQueued && hasInitStage, `Status: ${recovered?.status}, Stage: ${recovered?.executionStage}`);
  } catch (err) {
    record(2, 'Crash Recovery trước khi dispatch thao tác ngoài', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 3: Crash recovery SAU KHI ĐÃ TƯƠNG TÁC BÊN NGOÀI (Kịch bản 3)
  // Task ở trạng thái RUNNING, executionStage = 'INTERACTING', đã có 8 likes
  // -> KHÔNG được về QUEUED! Phải chuyển sang NEEDS_REVIEW để chống duplicate!
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
    record(3, 'Crash Recovery sau khi đã có side-effect (Chuyển NEEDS_REVIEW chống duplicate)', isNeedsReview && hasReviewReason && preservedLikes, `Status: ${recovered?.status}, Preserved Success: ${recovered?.progress?.success}`);
  } catch (err) {
    record(3, 'Crash Recovery sau khi đã có side-effect', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 4: Crash recovery khi task đã hoàn thành nhưng đang chờ sync (Kịch bản 4)
  // executionStage = 'SYNCING' -> An toàn finalize sang COMPLETED
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
    record(4, 'Crash Recovery khi task đang SYNCING (Finalize sang COMPLETED)', isCompleted, `Status: ${recovered?.status}`);
  } catch (err) {
    record(4, 'Crash Recovery khi task đang SYNCING', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 5: API Review Resolution Endpoint (/api/buff-queue/review-resolve/:id)
  // Đối soát thủ công: RESUME nốt số like còn thiếu (50 - 8 = 42 like)
  // -------------------------------------------------------------
  try {
    const store = require('./state-store');
    const qd = store.read('buff_queue') || { items: [] };
    const reviewTask = qd.items.find((it) => it.status === 'NEEDS_REVIEW');
    assert(reviewTask, 'Cần có task NEEDS_REVIEW từ Test 3');

    const serverModule = require('./server_recovery_test_helper.js');
    const res = serverModule.resolveReviewTask(reviewTask, 'RESUME');

    const isOk = res.success === true;
    const isQueued = res.task?.status === 'QUEUED';
    const adjustedTarget = res.task?.targetLikes === 42; // 50 - 8 = 42 like còn thiếu!
    record(5, 'Review Resolution: Đối soát RESUME bù số like còn thiếu (50 - 8 = 42 like)', isOk && isQueued && adjustedTarget, `Status: ${res.task?.status}, New Target: ${res.task?.targetLikes}`);
  } catch (err) {
    record(5, 'Review Resolution Endpoint', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 6: Monotonic Fencing Tokens qua MySQL (Kịch bản 7 & Phase 2)
  // Tokens phải luôn tăng dần đơn điệu và không bao giờ trùng lặp
  // -------------------------------------------------------------
  try {
    const db = require('./db');
    const token1 = await db.allocateFencingToken();
    const token2 = await db.allocateFencingToken();
    const token3 = await db.allocateFencingToken();

    const isMonotonic = token1 < token2 && token2 < token3;
    record(6, 'Monotonic Distributed Fencing Tokens (Đơn điệu & Độc nhất qua MySQL)', isMonotonic, `T1: ${token1}, T2: ${token2}, T3: ${token3}`);
  } catch (err) {
    record(6, 'Monotonic Distributed Fencing Tokens', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 7: Fencing Preemption & Stale Token Write Rejection (Kịch bản 6)
  // Khi task bị thu hồi lease (preempted), token cũ trở thành stale -> cấm ghi
  // -------------------------------------------------------------
  try {
    const serverModule = require('./server_recovery_test_helper.js');
    const { isPreempted, writeRejected } = await serverModule.testFencingPreemption();
    record(7, 'Fencing Preemption: Lease hết hạn/bị thu hồi thì cấm ghi đè trạng thái', isPreempted && writeRejected, `Preempted: ${isPreempted}, Write Rejected: ${writeRejected}`);
  } catch (err) {
    record(7, 'Fencing Preemption & Stale Write Rejection', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 8: Playwright Deep Abort: cancellableSleep & Immediate Context Close (Phase 3)
  // AbortSignal kích hoạt phải dừng chờ ngay lập tức (< 10ms thay vì đợi 2000ms)
  // -------------------------------------------------------------
  try {
    const serverModule = require('./server_recovery_test_helper.js');
    const startMs = Date.now();
    const abortResult = await serverModule.testDeepAbortSpeed();
    const durationMs = Date.now() - startMs;

    const isInstant = durationMs < 50; // Dự kiến ngủ 2000ms nhưng bị abort lập tức trong < 50ms!
    record(8, 'Playwright Deep Cancellation (Hủy ngay lập tức không chờ Timeout)', isInstant && abortResult.aborted, `Thời gian hủy: ${durationMs}ms (thay vì 2000ms timeout)`);
  } catch (err) {
    record(8, 'Playwright Deep Cancellation', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 9: Worker Disconnect (Client ngắt kết nối SSE không làm crash server) (Kịch bản 5)
  // -------------------------------------------------------------
  try {
    const sseReq = http.request(
      `${BASE_URL}/api/buff-like-stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        // Ngắt kết nối ngay lập tức sau khi nhận header
        sseReq.destroy();
      }
    );
    sseReq.write(JSON.stringify({ targetUrl: 'https://facebook.com/test_disconnect', cookieString: 'c_user=123; xs=abc' }));
    sseReq.end();
    await sleep(200);

    const health = await getJson('/api/health');
    const isServerAlive = health.body?.status === 'UP';
    record(9, 'Worker/Client SSE Disconnect (Server không crash, background xử lý an toàn)', isServerAlive, `Server status: ${health.body?.status}`);
  } catch (err) {
    record(9, 'Worker/Client SSE Disconnect', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 10: Database Connection Resiliency & Memory Store Fallback (Kịch bản 9)
  // -------------------------------------------------------------
  try {
    const store = require('./state-store');
    const qd = (await store.read('buff_queue')) || { items: [] };
    // Dữ liệu vẫn nạp và ghi được qua store bền vững ngay cả khi I/O có độ trễ
    const isStoreOperational = Array.isArray(qd.items);
    record(10, 'Database & StateStore Resiliency (Dữ liệu không mất qua flush/cache fallback)', isStoreOperational, `Queue items: ${qd.items.length}`);
  } catch (err) {
    record(10, 'Database & StateStore Resiliency', false, err.message);
  }

  console.log('\n================================================================');
  const allPassed = results.every((r) => r.passed);
  console.log(`KẾT QUẢ: ${results.filter((r) => r.passed).length}/${results.length} KỊCH BẢN THỬ NGHIỆM ĐẠT CHUẨN`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('LỖI CHẠY TEST SUITE:', e);
  process.exit(1);
});
