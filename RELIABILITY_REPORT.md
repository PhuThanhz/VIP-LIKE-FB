# BÁO CÁO ĐỘ TIN CẬY VÀ KHẢ NĂNG TỰ PHỤC HỒI (RELIABILITY & FAULT-TOLERANCE REPORT)
## DỰ ÁN: VIPLIKE RADIANT — PHIÊN BẢN BUFF LIKE 3.0 ENTERPRISE

---

### 1. TỔNG QUAN VỀ KIẾN TRÚC TIN CẬY (HIGH RELIABILITY GOALS)

Trong môi trường vận hành thực tế của các hệ thống tự động hoá mạng xã hội, các rủi ro gián đoạn luôn tiềm ẩn:
- Máy chủ bị khởi động lại đột ngột giữa chừng khi nhiều tác vụ đang chạy.
- Nền tảng bên ngoài (Facebook) thay đổi thuật toán, áp đặt giới hạn tốc độ (Rate Limit) hoặc yêu cầu xác thực lại (Checkpoint).
- Trình duyệt Playwright bị crash đột ngột do rò rỉ bộ nhớ hoặc xung đột hệ điều hành.
- Kết nối cơ sở dữ liệu MySQL bị ngắt quãng hoặc quá tải kết nối.

BUFF LIKE 3.0 được thiết kế với triết lý **Zero Single Point of Failure (Không có điểm sập đơn độc)** và **Graceful Self-Recovery (Tự phục hồi an toàn)**.

---

### 2. CÁC CƠ CHẾ BẢO VỆ VÀ TỰ PHỤC HỒI ĐÃ TRIỂN KHAI

#### 2.1. Tự Động Phục Hồi Tác Vụ Treo Sau Khi Khởi Động Lại (`recoverStaleRunningQueueTasks`)
- **Vấn đề**: Khi máy chủ bị tắt ngang hoặc khởi động lại (restart/deploy), các tác vụ đang ở trạng thái `RUNNING` sẽ bị kẹt vĩnh viễn ở trạng thái này vì tiến trình thực thi của chúng đã bị huỷ.
- **Giải pháp 3.0**:
  - Khi hệ thống khởi động và nạp xong trạng thái từ MySQL (`store.init(db)`), hàm `recoverStaleRunningQueueTasks()` được kích hoạt ngay lập tức.
  - Quét toàn bộ hàng đợi: Bất kỳ tác vụ nào mang trạng thái `RUNNING` nhưng không có ID trong `activeBuffTaskIds` của tiến trình hiện tại đều được chuyển tự động về `QUEUED`.
  - Cập nhật thông báo log: `"[Queue Recovery] 🔄 Đã tự động phục hồi X tác vụ bị gián đoạn do khởi động lại máy chủ sang QUEUED."`.
  - Các tác vụ này sẽ tiếp tục được thực thi mà không làm mất đơn hàng của người dùng.

#### 2.2. Kiểm Soát Bế Tắc Bằng Watchdog Timer (`Deadlock Watchdog`)
- **Vấn đề**: Khi một phiên duyệt Playwright gặp ngoại lệ ngoài luồng (Unhandled Exception) hoặc bị kill bởi OS OOM killer, khối lệnh giải phóng `busyBuffLanes.delete(uid)` không bao giờ được gọi, khiến tài khoản Via đó bị kẹt vĩnh viễn.
- **Giải pháp 3.0**:
  - Gắn nhãn thời gian sở hữu làn (Lease Timeout): 8 phút.
  - Khi hết 8 phút mà làn chưa được hoàn trả chủ động, bộ hẹn giờ Watchdog sẽ tự động cưỡng chế giải phóng làn khoá, ghi nhật ký cảnh báo và trao quyền điều phối cho tác vụ tiếp theo đang xếp hàng.
  - Ngoài ra, thời gian xếp hàng chờ đợi của các tác vụ (`buffLaneWaiters`) được giới hạn ở 60 giây (`WAITER_TIMEOUT_MS`). Nếu quá 60 giây không lấy được làn, yêu cầu tự động rời hàng chờ để tránh rò rỉ bộ nhớ.

#### 2.3. Hàng Đợi Thất Bại & Trì Hoãn Cấp Số Nhân (Exponential Backoff & Dead-Letter Queue)
- **Vấn đề**: Khi Via bị Facebook cảnh báo giới hạn tạm thời, việc retry liên tục và dồn dập khiến Via bị cấm vĩnh viễn (Action Block toàn trang) và làm tê liệt toàn bộ hàng đợi.
- **Giải pháp 3.0**:
  - **Exponential Backoff**: Khoảng thời gian chờ trước khi retry tăng theo cấp số nhân: $2^{\text{attempts}} \times 30\text{s}$ (30 giây $\rightarrow$ 60 giây $\rightarrow$ 120 giây).
  - **Dead-Letter Queue (DLQ)**: Nếu một tác vụ thất bại liên tiếp 3 lần, hoặc gặp phải các lỗi không thể tự phục hồi (như `CHECKPOINT`, `INVALID_PASSWORD`, `PAGE_BANNED`), tác vụ sẽ lập tức được chuyển sang trạng thái `DEAD_LETTER`.
  - Trạng thái `DEAD_LETTER` ngừng việc thử lại vô ích, gửi cảnh báo ngay tới Telegram của quản trị viên và giải phóng tài nguyên hệ thống cho các đơn hàng hợp lệ khác.

#### 2.4. Ngừng Hoạt Động An Toàn (Graceful Shutdown)
- **Vấn đề**: Khi nhận tín hiệu tắt hệ thống (`SIGINT` từ Ctrl+C hoặc `SIGTERM` từ Docker/Kubernetes), tiến trình thường dừng ngay lập tức khiến dữ liệu trong bộ nhớ đệm chưa kịp đồng bộ xuống MySQL bị mất mát.
- **Giải pháp 3.0**:
  - Đăng ký bộ lắng nghe sự kiện `SIGINT` và `SIGTERM`.
  - Khi nhận tín hiệu tắt máy, hệ thống từ chối nhận thêm tác vụ mới, giải phóng toàn bộ các làn khoá (`busyBuffLanes.clear()`, `buffLaneWaiters.length = 0`), kích hoạt `store.flush()` đồng bộ toàn bộ dữ liệu đang chờ xuống MySQL và cấp khoảng thời gian chờ (drain timeout) tối đa 4 giây trước khi thoát an toàn.

#### 2.5. Cơ Chế Chuyển Vùng Bảo Vệ Action Block (Action Block Failover)
- **Vấn đề**: Một số Fanpage trong danh sách có thể bị Facebook chặn tương tác riêng lẻ do lịch sử vi phạm nội dung cũ. Nếu công cụ dừng toàn bộ chiến dịch thì rất lãng phí thời gian của người dùng.
- **Giải pháp 3.0**:
  - Khi phát hiện một Fanpage bị lỗi Action Block (qua bộ lọc từ khoá và thông báo modal của Facebook), hệ thống ghi nhận trạng thái lỗi cho riêng Fanpage đó và tự động chuyển sang Fanpage tiếp theo trong tích tắc.
  - Nếu đã bật tuỳ chọn "Tự động bù Page khi có lỗi" (`autoReplenish`), hệ thống sẽ tự động bốc thêm một Page dự phòng trong danh sách để bù lại lượt like thiếu hụt, đảm bảo đạt đúng 100% KPI cam kết cho bài viết.

---

### 3. KẾT LUẬN KIỂM TRA ĐỘ ỔN ĐỊNH

| Kịch bản kiểm thử (Test Scenario) | Kết quả thực tế quan sát | Đánh giá độ tin cậy |
| :--- | :--- | :--- |
| **Kill tiến trình backend giữa chừng khi có 2 task chạy** | Sau khi khởi động lại, cả 2 task tự động chuyển sang `QUEUED` và tiếp tục chạy thành công. | ✅ ĐẠT (100% Phục hồi) |
| **Giả lập Playwright timeout không nhả lock** | Sau đúng 8 phút, Watchdog timer tự giải phóng lane, task kế tiếp được phục vụ bình thường. | ✅ ĐẠT (Chống Deadlock) |
| **Bắn tín hiệu `SIGINT` (Ctrl+C)** | Server log thông báo dọn dẹp, xả state vào MySQL thành công, thoát sạch sẽ mã 0. | ✅ ĐẠT (Graceful Shutdown) |
| **Tác vụ gặp lỗi lặp lại** | Áp dụng trì hoãn 30s, 60s, 120s và vào `DEAD_LETTER` sau lần 3, không gây thundering herd. | ✅ ĐẠT (Chống bão retry) |
| **Mất kết nối MySQL Workbench** | `StateStore` tự động chuyển sang cơ chế dự phòng file JSON, ứng dụng không sập và tự phục hồi khi MySQL online. | ✅ ĐẠT (Dual Persistence) |
