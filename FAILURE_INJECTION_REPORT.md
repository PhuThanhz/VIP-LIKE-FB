# BÁO CÁO THỬ NGHIỆM TIÊM LỖI (FAILURE INJECTION REPORT)
## BUFF LIKE 3.3 — HARDENING & CONCURRENCY VALIDATION

---

### 1. MỤC TIÊU & DANH SÁCH 10 KỊCH BẢN THỬ NGHIỆM

Bộ kiểm thử tự động `backend/test-failure-injection-3.3.js` được thiết kế để kiểm chứng khả năng chịu lỗi, tự phục hồi và bảo toàn tính toàn vẹn dữ liệu trong các tình huống xấu nhất:

| STT | Kịch bản Thử Nghiệm (Scenario) | Hành vi Mong Đợi | Kết Quả Thực Tế | Trạng Thái |
| :---: | :--- | :--- | :--- | :---: |
| **1** | Idempotency Key Deduplication | Cùng 1 Idempotency Key gửi lặp không tạo task trùng | Trả về task ID cũ, `alreadyQueued: true` | ✅ **PASS** |
| **2** | Crash trước khi dispatch thao tác ngoài | Task ở `PREPARING` tự động phục hồi về `QUEUED` | Phục hồi về `QUEUED`, `INITIALIZED` | ✅ **PASS** |
| **3** | Crash sau khi đã có side-effect | Task ở `INTERACTING` có partial likes chuyển `NEEDS_REVIEW` | Chuyển `NEEDS_REVIEW`, giữ nguyên 8 like | ✅ **PASS** |
| **4** | Crash khi task đang `SYNCING` | Đã like xong toàn bộ, chỉ chờ sync log -> Finalize | Finalize về `COMPLETED` an toàn | ✅ **PASS** |
| **5** | Review Resolution Endpoint | Đối soát thủ công bấm RESUME chỉ like số còn thiếu | `QUEUED` với mục tiêu mới = 42 like (50 - 8) | ✅ **PASS** |
| **6** | Monotonic Distributed Fencing Tokens | Fencing token sinh từ MySQL phải đơn điệu tăng dần | T1: 15001, T2: 16002, T3: 17003 ($T_1 < T_2 < T_3$) | ✅ **PASS** |
| **7** | Fencing Preemption & Stale Rejection | Task bị mất lease không được ghi đè trạng thái | `isPreempted: true`, `writeRejected: true` | ✅ **PASS** |
| **8** | Playwright Deep Cancellation | Ngắt tức thì khi có AbortSignal, không chờ sleep | Ngắt sau 11ms thay vì chờ 2000ms | ✅ **PASS** |
| **9** | Worker/Client SSE Disconnect | Client reload trang/ngắt stream không làm crash server | Server status: UP, tiến trình nền an toàn | ✅ **PASS** |
| **10** | Database & StateStore Resiliency | Đảm bảo tính nhất quán qua bộ nhớ đệm và MySQL | 9 items trong hàng đợi toàn vẹn | ✅ **PASS** |

---

### 2. LOG THỰC NGHIỆM CHI TIẾT TỪ TEST SUITE

```bash
$ node backend/test-failure-injection-3.3.js

================================================================
🧪 BẮT ĐẦU BUFF LIKE 3.3 FAILURE INJECTION & HARDENING SUITE
================================================================

[Test 1] ✅ PASS: Idempotency Key Deduplication (Chống trùng task gửi lặp)
   └─ Task ID: task_1793584727072_166, Deduped: true
[Test 2] ✅ PASS: Crash Recovery trước khi dispatch thao tác ngoài (An toàn về QUEUED)
   └─ Status: QUEUED, Stage: INITIALIZED
[Test 3] ✅ PASS: Crash Recovery sau khi đã có side-effect (Chuyển NEEDS_REVIEW chống duplicate)
   └─ Status: NEEDS_REVIEW, Preserved Success: 8
[Test 4] ✅ PASS: Crash Recovery khi task đang SYNCING (Finalize sang COMPLETED)
   └─ Status: COMPLETED
[Test 5] ✅ PASS: Review Resolution: Đối soát RESUME bù số like còn thiếu (50 - 8 = 42 like)
   └─ Status: QUEUED, New Target: 42
[Test 6] ✅ PASS: Monotonic Distributed Fencing Tokens (Đơn điệu & Độc nhất qua MySQL)
   └─ T1: 15001, T2: 16002, T3: 17003
[Test 7] ✅ PASS: Fencing Preemption: Lease hết hạn/bị thu hồi thì cấm ghi đè trạng thái
   └─ Preempted: true, Write Rejected: true
[Test 8] ✅ PASS: Playwright Deep Cancellation (Hủy ngay lập tức không chờ Timeout)
   └─ Thời gian hủy: 11ms (thay vì 2000ms timeout)
[Test 9] ✅ PASS: Worker/Client SSE Disconnect (Server không crash, background xử lý an toàn)
   └─ Server status: UP
[Test 10] ✅ PASS: Database & StateStore Resiliency (Dữ liệu không mất qua flush/cache fallback)
   └─ Queue items: 9

================================================================
KẾT QUẢ: 10/10 KỊCH BẢN THỬ NGHIỆM ĐẠT CHUẨN
================================================================
```

---

### 3. ĐÁNH GIÁ CÁC TIÊU CHÍ AN TOÀN

1. **Có mất task không?**
   - **KHÔNG**. 100% các task ở mọi giai đoạn đều được lưu vết trong MySQL `app_state` và file JSON dự phòng.
2. **Có thực hiện thao tác trùng không?**
   - **KHÔNG**. Idempotency Key chặn các request trùng từ giao diện; Crash Recovery chuyển các task dở dang sang `NEEDS_REVIEW` để người dùng xác nhận số like cần bù.
3. **Có ghi đè trạng thái không?**
   - **KHÔNG**. Fencing Token Engine kiểm tra tính hợp lệ trước khi cho phép ghi dữ liệu; các token cũ bị stale sẽ bị từ chối lập tức.
4. **Có giải phóng nhầm lock không?**
   - **KHÔNG**. Khóa chỉ được giải phóng nếu Token của tác vụ sở hữu trùng khớp với Token hiện tại của làn (`active.leaseToken === leaseToken`).
