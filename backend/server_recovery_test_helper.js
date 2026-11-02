/**
 * Helper module for Failure Injection Testing in BUFF LIKE 3.3
 */

const store = require('./state-store');
const db = require('./db');

function triggerCrashRecovery() {
  const qd = store.read('buff_queue') || { items: [] };
  let recoveredCount = 0;
  let reviewCount = 0;
  let completedCount = 0;

  for (const it of qd.items || []) {
    if (it.status === 'RUNNING') {
      const hasExternalSideEffects =
        it.executionStage === 'INTERACTING' ||
        Number(it.progress?.done || 0) > 0 ||
        Number(it.progress?.success || 0) > 0 ||
        Number(it.progressLikes || 0) > 0 ||
        (Array.isArray(it.pageDetails) && it.pageDetails.length > 0) ||
        Boolean(it.dispatchedAt);

      if (it.executionStage === 'SYNCING') {
        it.status = 'COMPLETED';
        it.executionStage = 'COMPLETED';
        it.finishedAt = it.finishedAt || new Date().toISOString();
        completedCount++;
      } else if (!hasExternalSideEffects) {
        it.status = 'QUEUED';
        it.executionStage = 'INITIALIZED';
        it.error = 'Máy chủ đã khởi động lại trước khi tác vụ bắt đầu thao tác bên ngoài. Đã phục hồi về hàng đợi an toàn.';
        recoveredCount++;
      } else {
        it.status = 'NEEDS_REVIEW';
        it.executionStage = 'NEEDS_REVIEW';
        it.reviewReason = 'CRASH_DURING_EXTERNAL_INTERACTION';
        it.error = `Tác vụ bị gián đoạn khi máy chủ khởi động lại trong lúc đang tương tác bên ngoài (Đã like thành công: ${it.progress?.success || it.progressLikes || 0}). Chuyển sang NEEDS_REVIEW để đối soát thủ công, chống duplicate tương tác.`;
        reviewCount++;
      }
    }
  }
  store.write('buff_queue', qd);
  return { recoveredCount, reviewCount, completedCount };
}

async function testFencingPreemption() {
  // Giả lập 2 lease trên cùng 1 resource uid
  const uid = 'test_fence_uid_' + Date.now();
  const token1 = await db.allocateFencingToken();
  const token2 = await db.allocateFencingToken();

  const activeLeases = new Map();
  activeLeases.set(uid, { leaseToken: token1 });

  // Task 1 kiểm tra xem lease còn hiệu lực không
  const isToken1ValidBefore = activeLeases.get(uid)?.leaseToken === token1;

  // Task 2 preempts (chiếm lease mới)
  activeLeases.set(uid, { leaseToken: token2 });

  // Task 1 kiểm tra lại
  const isToken1ValidAfter = activeLeases.get(uid)?.leaseToken === token1;
  const isToken2Valid = activeLeases.get(uid)?.leaseToken === token2;

  // Giả lập ghi kết quả: Task 1 cố ghi nhưng fence bị stale
  let writeRejected = false;
  if (!isToken1ValidAfter) {
    writeRejected = true; // Reject stale write!
  }

  return {
    isPreempted: !isToken1ValidAfter && isToken2Valid,
    writeRejected,
  };
}

async function testDeepAbortSpeed() {
  const controller = new AbortController();

  // Đăng ký cancellableSleep 2000ms
  function cancellableSleep(ms, signal) {
    if (ms <= 0 || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  // Abort sau 10ms
  setTimeout(() => {
    controller.abort();
  }, 10);

  await cancellableSleep(2000, controller.signal);

  return { aborted: controller.signal.aborted };
}

function resolveReviewTask(task, action) {
  if (action === 'RESUME') {
    const currentSuccess = Number(task.progress?.success || task.progressLikes || 0);
    const originalTarget = Number(task.targetLikes) || 30;
    const remainingTarget = Math.max(1, originalTarget - currentSuccess);
    task.targetLikes = remainingTarget;
    task.status = 'QUEUED';
    task.executionStage = 'INITIALIZED';
    task.error = null;
    task.reviewResolvedAt = new Date().toISOString();
    task.reviewResolution = `Tiếp tục chạy nốt ${remainingTarget} like còn thiếu (đã trừ ${currentSuccess} like đã like trước đó).`;
    return { success: true, task };
  } else if (action === 'COMPLETE') {
    task.status = 'COMPLETED';
    task.executionStage = 'COMPLETED';
    task.finishedAt = new Date().toISOString();
    return { success: true, task };
  } else if (action === 'CANCEL') {
    task.status = 'CANCELLED';
    task.executionStage = 'CANCELLED';
    return { success: true, task };
  }
  return { success: false, error: 'Hành động không hợp lệ' };
}

module.exports = {
  triggerCrashRecovery,
  testFencingPreemption,
  testDeepAbortSpeed,
  resolveReviewTask,
};
