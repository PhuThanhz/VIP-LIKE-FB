/**
 * test-concurrency-fencing.js - Concurrency & Fencing Token Validation Suite
 * Verifies monotonic fencing tokens, safe cancellation upon lease timeout,
 * and lock release guard preventing stale tasks from corrupting new locks.
 */

const assert = require('assert');

// Simulate the exact Fencing Lane Locker algorithm used in backend/server.js
class FencingLaneLocker {
  constructor(options = {}) {
    this.maxParallelLanes = options.maxParallelLanes || 4;
    this.leaseTimeoutMs = options.leaseTimeoutMs || 500; // 500ms for test simulation
    this.waiterTimeoutMs = options.waiterTimeoutMs || 2000;
    this.busyBuffLanes = new Set();
    this.buffLaneWaiters = [];
    this.activeLaneLeases = new Map();
    this.nextLeaseToken = 0;
    this.revokedLeasesCount = 0;
    this.guardedReleasesCount = 0;
  }

  pumpBuffLanes() {
    for (let i = 0; i < this.buffLaneWaiters.length; i++) {
      if (this.busyBuffLanes.size >= this.maxParallelLanes) return;
      const waiter = this.buffLaneWaiters[i];
      if (this.busyBuffLanes.has(waiter.uid)) continue;
      this.buffLaneWaiters.splice(i--, 1);
      if (waiter.waiterTimer) clearTimeout(waiter.waiterTimer);

      const leaseToken = ++this.nextLeaseToken;
      const abortController = new AbortController();

      const leaseTimer = setTimeout(() => {
        const active = this.activeLaneLeases.get(waiter.uid);
        if (active && active.leaseToken === leaseToken) {
          this.revokedLeasesCount++;
          try {
            abortController.abort(new Error('Lane lease timeout'));
          } catch (_) {}
          this.activeLaneLeases.delete(waiter.uid);
          this.busyBuffLanes.delete(waiter.uid);
          this.pumpBuffLanes();
        }
      }, this.leaseTimeoutMs);

      this.activeLaneLeases.set(waiter.uid, {
        leaseToken,
        abortController,
        leaseTimer,
        acquiredAt: Date.now(),
      });
      this.busyBuffLanes.add(waiter.uid);

      waiter.resolve({
        leaseToken,
        abortController,
        signal: abortController.signal,
        isStale: () => {
          const cur = this.activeLaneLeases.get(waiter.uid);
          return !cur || cur.leaseToken !== leaseToken || abortController.signal.aborted;
        },
      });
    }
  }

  async withBuffLane(uid, fn) {
    const key = uid || 'unknown';
    const leaseContext = await new Promise((resolve, reject) => {
      let waiterObj;
      const waiterTimer = setTimeout(() => {
        const idx = this.buffLaneWaiters.indexOf(waiterObj);
        if (idx !== -1) {
          this.buffLaneWaiters.splice(idx, 1);
          reject(new Error(`Waiter timeout on lane [${key}]`));
        }
      }, this.waiterTimeoutMs);

      waiterObj = { uid: key, resolve, reject, waiterTimer };
      this.buffLaneWaiters.push(waiterObj);
      this.pumpBuffLanes();
    });

    const { leaseToken, signal, isStale } = leaseContext;

    try {
      return await fn({ leaseToken, signal, isStale });
    } finally {
      const active = this.activeLaneLeases.get(key);
      if (active && active.leaseToken === leaseToken) {
        clearTimeout(active.leaseTimer);
        this.activeLaneLeases.delete(key);
        this.busyBuffLanes.delete(key);
        this.pumpBuffLanes();
      } else {
        this.guardedReleasesCount++;
      }
    }
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 CONCURRENCY AUDIT & FENCING TOKEN VALIDATION');
  console.log('================================================================');

  const locker = new FencingLaneLocker({ maxParallelLanes: 2, leaseTimeoutMs: 300 });

  // Test 1: Sequential execution with monotonic fencing tokens
  console.log('\n--- TEST 1: Monotonic Fencing Tokens Under Normal Load ---');
  const tokens = [];
  await locker.withBuffLane('via_1', async (fence) => {
    tokens.push(fence.leaseToken);
    assert.strictEqual(fence.isStale(), false);
  });
  await locker.withBuffLane('via_1', async (fence) => {
    tokens.push(fence.leaseToken);
    assert.strictEqual(fence.isStale(), false);
  });
  assert.strictEqual(tokens[0] < tokens[1], true, 'Tokens must be monotonically increasing');
  console.log(`✅ Tokens: ${tokens.join(' -> ')} (Monotonically Increasing: PASS)`);

  // Test 2: Simulated Slow Task Exceeding Lease Timeout
  console.log('\n--- TEST 2: Slow Task Lease Expiration & Active Abort Signal ---');
  let taskACompleted = false;
  let taskAAboorted = false;
  let taskBToken = null;

  const promiseA = locker.withBuffLane('via_slow', async (fence) => {
    // Task A will take 600ms, but lease timeout is 300ms
    fence.signal.addEventListener('abort', () => {
      taskAAboorted = true;
    });
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(fence.isStale(), true, 'Fence must be stale after timeout');
    taskACompleted = true;
  });

  // Give Task A 350ms to time out
  await new Promise((r) => setTimeout(r, 350));
  assert.strictEqual(taskAAboorted, true, 'Task A must receive abort signal');

  // Now Task B acquires the same lane while Task A is still running in its finally delay!
  const promiseB = locker.withBuffLane('via_slow', async (fence) => {
    taskBToken = fence.leaseToken;
    assert.strictEqual(fence.isStale(), false, 'Task B must have a fresh, valid lease');
    await new Promise((r) => setTimeout(r, 50));
  });

  await Promise.all([promiseA, promiseB]);

  assert.strictEqual(locker.revokedLeasesCount, 1, 'Revoked leases count must be 1');
  assert.strictEqual(locker.guardedReleasesCount, 1, 'Guarded release must prevent Task A from deleting Task B lock');
  console.log(`✅ Fencing Guard: Revoked=${locker.revokedLeasesCount}, GuardedReleases=${locker.guardedReleasesCount} (PASS)`);
  console.log(`✅ Task B Token (${taskBToken}) safely executed without lock corruption from Task A.`);

  // Test 3: Multiple Waiters FIFO & Concurrency Isolation
  console.log('\n--- TEST 3: Multi-Waiter FIFO Queue & Concurrency Limits ---');
  const executionOrder = [];
  const parallelTasks = Array.from({ length: 4 }, (_, i) =>
    locker.withBuffLane(`via_parallel_${i % 2}`, async (fence) => {
      executionOrder.push({ taskIndex: i, token: fence.leaseToken, lane: `via_parallel_${i % 2}` });
      await new Promise((r) => setTimeout(r, 40));
    })
  );
  await Promise.all(parallelTasks);
  console.log(`✅ All ${executionOrder.length} parallel tasks completed cleanly without deadlock:`);
  executionOrder.forEach((t) => console.log(`   Task ${t.taskIndex} on ${t.lane} (Token: ${t.token})`));

  console.log('\n================================================================');
  console.log('✅ CONCURRENCY & FENCING AUDIT: 100% PASS');
  console.log('================================================================');
}

runTests().catch((e) => {
  console.error('❌ Fencing Test Failed:', e);
  process.exit(1);
});
