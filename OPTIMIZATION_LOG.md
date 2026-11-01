# 📝 NHẬT KÝ TỐI ƯU HÓA — BUFF LIKE 2.0 (OPTIMIZATION LOG)

Nhật ký ghi lại toàn bộ các thay đổi kỹ thuật, tối ưu hóa code, cấu trúc dữ liệu và kết quả kiểm thử.

---

## [2026-11-02] — CHIẾN DỊCH NÂNG CẤP TOÀN DIỆN BUFF LIKE 2.0

### 1. Phân Tích & Xác Định Điểm Nghẽn Trầm Trọng (Root Cause Analysis)
- **Tình trạng người dùng phản ánh:** *"sao lâu dữ vậy người anh em"* (Ảnh đính kèm cho thấy mất 5377s / 1g 29p để chạy 277 like trên 3 bài viết, tức 19.4s / like; các bài chỉ đạt 68/200, 197/200, 12/200 like nhưng UI vẫn hiện tag xanh "Hoàn thành").
- **Điểm nghẽn 1 (Tốc độ Playwright 19.4s/like):**
  - Khi Fast-Switch trượt mục tiêu do dropdown dài (633 page), hệ thống fallback sang gọi 3 lần `tab.goto()` liên tiếp: `facebook.com` $\rightarrow$ `profile.php?id=...` $\rightarrow$ `targetUrl`. Nạp lại toàn bộ DOM Facebook 3 lần tốn tới 12 - 15 giây cho mỗi lượt like.
  - Hàm `verifyReacted` chờ cứng 3200ms mỗi lượt kiểm tra trạng thái nút.
- **Điểm nghẽn 2 (Đứt gãy do Action Block):**
  - Trong multi-worker engine, khi 1 page đơn lẻ gặp thông báo rate limit của Facebook, cờ `actionBlocked` lập tức kích hoạt `globalStopTriggered = true` và `break`, làm dừng toàn bộ 150+ page còn lại của đơn hàng.
- **Điểm nghẽn 3 (Hiển thị sai lệch trạng thái Batch):**
  - Trong `BuffEngagement.tsx`: `counts.success + counts.alreadyLiked > 0 ? 'COMPLETED' : 'FAILED'`. Bất kỳ bài viết nào có $\ge 1$ like thành công đều bị gán trạng thái `COMPLETED` màu xanh, dẫn đến thông báo "Đã hoàn tất 3/3 bài viết" trong khi thực tế chỉ hoàn thành 277/600 like (46%).
- **Điểm nghẽn 4 (Độ trễ API & Băng thông Payload):**
  - API `/api/buff-logs` trả về toàn bộ cột JSON `details` (chứa hàng trăm page log) cho mọi request GET, tạo payload multi-megabyte gây lag giật giao diện khi nạp lại danh sách lịch sử.
  - Trang chủ nạp đồng thời toàn bộ tabs (Via Management, Queue, Hunter, Settings, License) khiến bundle khởi đầu phình to tới 471 kB.

---

### 2. Các Giải Pháp Kỹ Thuật Đã Triển Khai

#### A. Database Optimization (`backend/db.js`)
- Tăng connection pool lên 25 (`connectionLimit: 25`, `maxIdle: 15`).
- Tự động kiểm tra và khởi tạo 4 Covering Indexes chuyên dụng:
  - `idx_history_created_covering` trên `buff_history (created_at DESC, status, page_id)`.
  - `idx_page_profile_active` trên `facebook_page_accesses (personal_profile_id, active, page_id)`.
  - `idx_queue_status_time` trên `buff_queue (status, schedule_time, id)`.
  - `idx_logs_type_time` trên `buff_logs (run_type, created_at DESC)`.
- Kết quả: EXPLAIN Query Cost trên bảng `buff_history` giảm từ **193 xuống còn 0.273** (cải thiện **706x**, loại bỏ hoàn toàn filesort).

#### B. Backend API Latency & Memory Throttling (`backend/server.js`, `backend/avatar-tool.js`)
- Thêm tham số `summaryOnly=true` cho `db.getBuffLogs(limit, summaryOnly)`: Bỏ qua cột chi tiết nặng `details` khi lấy danh sách. Giảm kích thước payload từ ~2MB xuống ~12KB; độ trễ giảm từ ~30ms xuống **~1.03ms - 1.49ms**.
- Bổ sung endpoint chuyên dụng `GET /api/buff-logs/:id` nạp chi tiết theo yêu cầu (on-demand) với độ trễ **~2.69ms**.
- Thêm bộ nhớ đệm in-memory 15s (`memoryAvatarCache`) trong `avatar-tool.js`: Loại bỏ đọc đĩa đồng bộ (`fs.readFileSync`) trên mỗi request `/api/buff-cached-pages`, đưa thời gian nạp 633 pages xuống **6.2ms**.
- Chuyển đổi quản lý phiên live sang `activeLiveBuffSessions` Map: Hỗ trợ đa phiên đồng thời, chống xung đột biến toàn cục khi chạy nhiều bài song song trong Batch Mode.

#### C. Playwright Automation Engine Refactoring (`backend/fb-buff-tool.js`)
- **Triệt tiêu 3x Page Navigations khi đổi danh tính:**
  - Tối ưu hóa bộ chọn Voice Switcher ngay trên bài viết và modal "Xem tất cả trang cá nhân".
  - Tự động điền tên Fanpage vào ô tìm kiếm modal thay vì cuộn mù.
  - Bổ sung cơ chế tiêm cookie `i_user` kết hợp reload nhẹ tại chỗ (`tab.reload()`), giữ nguyên tab tại URL bài viết, tiết kiệm **8 - 12 giây** cho mỗi lượt like.
- **Rút ngắn chu kỳ phản hồi `verifyReacted`:**
  - Giảm polling interval xuống 50ms (thay vì 90ms).
  - Điều chỉnh timeout linh hoạt theo `speedMode`: Siêu Tốc (700ms), Nhanh (1200ms) thay vì chờ cố định 3200ms.
- **Cơ chế Chống Đứt Gãy Khi Gặp Action Block:**
  - Bỏ lệnh dừng ngắt toàn bộ (`globalStopTriggered = true; break`).
  - Chuyển sang cơ chế theo dõi `consecutiveBlocks`: Chỉ bỏ qua (skip) page bị chặn, tạm nghỉ 8s rồi chuyển giao cho page/Via tiếp theo trong danh sách.
  - Phối hợp tự động failover giữa 38 Via trong kho để đảm bảo tiến độ về đích 100% KPI.

#### D. Frontend Code-Splitting & SaaS 2.0 UI/UX (`frontend/src/pages/BuffEngagement.tsx`, `frontend/vite.config.ts`, `frontend/src/App.tsx`)
- **Vite Code-Splitting:**
  - Tách các module quản trị nặng (`ViaManagementPage`, `BuffQueueTab`, `PostHunterTab`, `SystemSettingsPage`, `LicenseManagementPage`, `LoginPage`) thành các chunk nạp trễ (`React.lazy`).
  - Tách riêng `antd-icons` (38 kB) và `react-vendor` (194 kB).
  - Main bundle nạp ban đầu giảm từ **471.36 kB xuống còn 111.50 kB (giảm 76.3%)**.
- **Chính Xác Hóa Trạng Thái Batch Mode:**
  - Bổ sung trạng thái `'PARTIAL'` vào `BatchOrder`.
  - Đơn hàng chỉ được gắn nhãn `Hoàn thành 100%` (màu xanh) khi số like thực tế $\ge$ mục tiêu.
  - Đơn hàng thiếu like hiển thị nhãn cảnh báo màu vàng: `⚠️ Đạt X/Y (Thiếu Z like)` kèm nút bấm **🚀 Bù like** nổi bật.
  - Tiêu đề Batch cập nhật trung thực: `Đã hoàn tất X/Y bài viết (Z bài cần bù like)`.
  - 4 Ô thống kê KPI hiển thị chuẩn: `Tổng like mục tiêu`, `Thành công`, `Đã like trước`, `Còn thiếu / Cần bù`.
  - Thêm tính năng 1-click **🚀 Bù like cho các bài còn thiếu** trong hộp tóm tắt khi kết thúc Batch.
- **Trải Nghiệm SaaS Cao Cấp:**
  - Tích hợp bộ Skeleton Loaders (`CardSkeleton`, `TableSkeleton`, `PageSkeleton`) thay cho spinner đơn điệu.
  - Thêm thẻ nhận diện loại link tự động (`PasteLinkInput.tsx`) cho Reels, Group, Video, Post.
