# NHẬT KÝ NÂNG CẤP PHIÊN BẢN (CHANGELOG)
## BUFF LIKE 3.3 — CRASH-SAFE EXECUTION & DISTRIBUTED CONCURRENCY HARDENING

---

### 1. PHỤC HỒI SAU CRASH (CRASH RECOVERY ENGINE)
- **Xóa bỏ Blind Recovery**: Chấm dứt việc tự động chuyển tất cả các task `RUNNING` về `QUEUED` khi backend restart.
- **Phân loại ranh giới Side-Effect**:
  - `PREPARING` (chưa gửi thao tác ra bên ngoài) $\rightarrow$ Tự động chuyển về `QUEUED` với `executionStage = 'INITIALIZED'`.
  - `INTERACTING` (đang thao tác hoặc đã like thành công một phần) $\rightarrow$ Tự động chuyển về `NEEDS_REVIEW`, bảo toàn số like đã like và chi tiết `pageDetails`.
  - `SYNCING` (đã like xong toàn bộ, chỉ chờ sync log) $\rightarrow$ Tự động hoàn tất về `COMPLETED`.
- **API Đối Soát Thủ Công (`/api/buff-queue/review-resolve/:id`)**:
  - Hỗ trợ 3 hành động: `RESUME` (chạy bù số like còn thiếu), `COMPLETE` (chấp nhận kết quả hiện tại), `CANCEL` (hủy bỏ tác vụ).

---

### 2. FENCING TOKEN ĐƠN ĐIỆU BỀN VỮNG (MONOTONIC DISTRIBUTED FENCING)
- **Lưu trữ Fencing Epoch trên MySQL**: Thêm trường `global_fencing_epoch` vào bảng `app_state` với hàm `allocateFencingToken()` trong `backend/db.js`.
- **Chống Reset sau Restart**: Token được tính toán dựa trên `epoch * 1000 + sequence`, đảm bảo luôn tăng dần đơn điệu qua mọi lần khởi động lại máy chủ và giữa các tiến trình khác nhau.
- **Bảo vệ thời điểm ghi (Stale Write Guard)**: Từ chối mọi thao tác ghi dữ liệu của các tác vụ có Fencing Token cũ đã bị thu hồi hoặc hết hạn lease.

---

### 3. HỦY BỎ SÂU PLAYWRIGHT (DEEP CANCELLATION)
- **Truyền `AbortSignal` xuyên suốt**: `signal` được truyền từ `withBuffLane` xuống `buffLikesWithPages`, `executePageInteraction`, và `switchTabIdentity`.
- **Hàm `cancellableSleep`**: Thay thế toàn bộ các lệnh `setTimeout` không thể hủy bằng `cancellableSleep`, giúp các tác vụ dừng ngay lập tức (< 11ms) khi có lệnh hủy thay vì kẹt trong thời gian cooldown 15-20 giây.
- **Đóng tức thì Browser Tabs & Contexts**: Khi nhận tín hiệu `abort`, hệ thống lập tức đóng các tab đang mở, ngắt mọi promise DOM đang chờ.

---

### 4. GIAO DIỆN & TIẾN TRÌNH BATCH STREAM
- **Sửa triệt để lỗi Kẹt trạng thái "ĐANG CHẠY"**:
  - Cập nhật backend `server.js` luôn gán `sess.status = 'DONE'` khi kết thúc duyệt nick (dù đủ hay thiếu KPI), không bao giờ treo `RUNNING`.
  - Cập nhật frontend `isAllBatchOrdersDone` bao gồm đầy đủ cả `PARTIAL`, `COMPLETED`, `FAILED`, `PAUSED`.
  - Dừng đồng hồ đếm và hiển thị `🏁 ĐÃ DUYỆT HẾT NICK` khi kết thúc đợt chạy.
- **Sửa 4 ô KPI Metrics**: Khóa chặt logic Batch, hiển thị đúng `Tổng mục tiêu: 600 like`, `Đã like thành công: 277 like`, `Còn thiếu: 323 like` thay vì nhầm lẫn số bài viết.
- **Báo cáo chuẩn xác từng bài viết**:
  - Đủ 100% KPI $\rightarrow$ `✅ Hoàn thành 100%`.
  - Thiếu $\rightarrow$ `⚠️ Đạt X/Y like` kèm nút `🚀 Bù like` 1 chạm.

---

### 5. KIỂM THỬ & CHẤP NHẬN (VERIFICATION & COMPLIANCE)
- ✅ `backend/test-failure-injection-3.3.js`: **10/10 kịch bản kiểm thử tiêm lỗi ĐẠT CHUẨN (100% PASS)**.
- ✅ `backend/test-soak-3.3.js`: **4,992 HTTP requests** trong 60 giây, Event Loop Lag trung bình **0.023 ms**, V8 Heap ổn định không rò rỉ.
- ✅ Biên soạn đầy đủ 6 tài liệu kiểm toán theo chuẩn kiến trúc hệ thống.
