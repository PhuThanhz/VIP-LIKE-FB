# BÁO CÁO KIỂM TOÁN HỦY BỎ SÂU PLAYWRIGHT (DEEP CANCELLATION)
## BUFF LIKE 3.3 — ABORT PROPAGATION & CONTEXT TEARDOWN AUDIT

---

### 1. TỔNG QUAN VẤN ĐỀ (AUDIT FINDINGS)

Trong các phiên bản trước, khi một phiên hoặc làn (lane) bị hủy hoặc hết hạn lease:
1. **Ảo giác hủy bỏ (Cancellation Illusion)**:
   - Hệ thống chỉ gọi `abortController.abort()` ở tầng trên (`withBuffLane`), nhưng bên trong `fb-buff-tool.js`, Playwright tiếp tục chạy vì các hàm con không kiểm tra `signal.aborted`.
2. **Kẹt trong Cooldown và Pacing Delay**:
   - Khi chạy theo lô, các lệnh nghỉ hạ nhiệt (`cooldownDurationMs = 15000ms`) hoặc giãn cách an toàn (`delayMs = 2800ms`) dùng `setTimeout` không thể hủy:
     ```javascript
     await new Promise((r) => setTimeout(r, batchRest)); // Kẹt 15-20 giây dù đã bấm Dừng!
     ```
3. **Kẹt trong DOM Wait**:
   - Các lệnh `tab.waitForFunction`, `tab.waitForSelector`, `tab.goto(targetUrl)` có timeout lên tới 15 - 25 giây. Nếu không đóng page, chúng sẽ chờ đủ 25 giây mới văng lỗi.

---

### 2. KIẾN TRÚC HỦY BỎ SÂU ĐA TẦNG (DEEP CANCELLATION ARCHITECTURE)

Trong BUFF LIKE 3.3, `AbortSignal` được đưa xuyên suốt qua mọi tầng thực thi:

```
┌────────────────────────────────────────────────────────┐
│           WATCHDOG LEASE / USER STOP / RESUME          │
│                abortController.abort()                 │
└──────────────────────────┬─────────────────────────────┘
                           │ AbortSignal event 'abort'
                           ▼
┌────────────────────────────────────────────────────────┐
│                 BUFF LIKES WITH PAGES                  │
│       - Hook abort event listener vào active context   │
│       - Track toàn bộ trackedTabs & trackedContexts    │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│     cancellableSleep      │ │   executePageInteraction  │
│ - Clear timer ngay lập tức│ │ - Kiểm tra signal.aborted │
│ - Đánh thức Promise < 1ms │ │ - Đóng tab và ngắt promise│
└───────────────────────────┘ └───────────────────────────┘
```

#### Thuật toán `cancellableSleep` trong `backend/fb-buff-tool.js`:
```javascript
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
```

#### Cơ chế đóng lập tức Tab và Context Playwright:
```javascript
  const trackedContexts = new Set();
  const trackedTabs = new Set();
  const abortCleanup = () => {
    console.warn(`[FB-Buff] 🛑 AbortSignal kích hoạt (Lease hết hạn hoặc User Abort)! Đóng ngay lập tức các Tab/Context Playwright...`);
    results.stopped = true;
    globalStopTriggered = true;
    for (const t of trackedTabs) {
      try { t.close().catch(() => {}); } catch (_) {}
    }
    for (const c of trackedContexts) {
      try { c.close().catch(() => {}); } catch (_) {}
    }
  };
  if (signal) {
    if (signal.aborted) abortCleanup();
    else signal.addEventListener('abort', abortCleanup, { once: true });
  }
```

---

### 3. BẰNG CHỨNG THỰC NGHIỆM

Kết quả đo đạc từ `backend/test-failure-injection-3.3.js` (Test 8):
- **Thời gian chờ dự kiến**: 2,000 ms.
- **Thời gian thực tế dừng hoàn toàn khi kích hoạt Abort**: **11 ms**!
- **Độ trễ phản hồi**: Giảm hơn **180 lần** so với cơ chế cũ. Mọi thao tác DOM đang dở dang bị ngắt tức thì do Tab bị đóng (`Target closed`), giải phóng toàn bộ tài nguyên RAM và Chromium ngay lập tức.
