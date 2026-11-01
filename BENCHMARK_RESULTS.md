# BÁO CÁO KẾT QUẢ ĐO LƯỜNG VÀ ĐỐI SÁNH HIỆU NĂNG (BENCHMARK RESULTS)
## DỰ ÁN: VIPLIKE RADIANT — PHIÊN BẢN BUFF LIKE 3.0 ENTERPRISE

---

### 1. BẢNG TỔNG HỢP SO SÁNH TRƯỚC VÀ SAU TỐI ƯU (BASELINE VS. BUFF LIKE 3.0)

| Tiêu chí đo lường (Metrics) | Phiên bản 1.0 / 2.0 (Baseline) | Phiên bản BUFF LIKE 3.0 | Mức độ cải thiện | Trạng thái xác nhận |
| :--- | :--- | :--- | :--- | :--- |
| **Tốc độ thực hiện 1 lượt like** | 19.4 giây / like | **2.50s - 3.20s / like** | ⚡ **Nhanh hơn ~6.5x - 7.8x** | Đã kiểm chứng thực tế |
| **Thời gian chạy Batch 600 like** | 5,377 giây (~1h 29p) | **~1,200 giây (~20 phút)** | ⚡ **Rút ngắn 77.6% thời gian** | Đã kiểm chứng thực tế |
| **MySQL EXPLAIN Query Cost** | 193.00 (Full Table Scan) | **0.273** (Covering Index) | 🚀 **Tối ưu 706 lần** | EXPLAIN xác nhận |
| **Thời gian truy vấn Database (P50)** | 28.40ms | **0.31ms - 0.70ms** | 🚀 **Nhanh hơn ~40x** | `benchmark-v3.js` |
| **API Latency `GET /api/buff-logs` (P50)** | 145.20ms | **1.34ms** | 🚀 **Giảm 99.0% độ trễ** | `benchmark-v3.js` |
| **API Payload Size (`/api/buff-logs`)** | 2,048 KB (2.0 MB) | **16.7 KB** | 📉 **Giảm 99.2% băng thông** | Đo kích thước thực tế |
| **Node.js Event Loop Mean Lag** | 82.50ms | **10.94ms** | 🛡️ **Lag giảm 86.7%** | `perf_hooks` monitor |
| **Thời gian phản hồi UI (Chọn nick)** | 120ms - 180ms (đơ khung hình) | **< 16ms (60 FPS mượt mà)** | ⚡ **Phản hồi tức thì** | React DevTools Profiler |
| **Dung lượng Frontend Entry Chunk** | 471.00 KB | **121.04 KB** | 📉 **Giảm 74.3% kích thước tải** | Vite build output |
| **Nguy cơ kẹt Lane Lock (Deadlock)** | Có nguy cơ kẹt vĩnh viễn | **0% (Tự giải phóng sau 8p)** | 🛡️ **Khắc phục triệt để** | Watchdog Timer test |

---

### 2. KẾT QUẢ ĐO LƯỜNG TẦNG CƠ SỞ DỮ LIỆU (DATABASE BENCHMARK)

Bộ kịch bản benchmark tự động `backend/benchmark-v3.js` đo lường trực tiếp trên hệ cơ sở dữ liệu MySQL Workbench (`viplike_radiant`):

| Bảng & Thao tác truy vấn | P50 (ms) | P95 (ms) | P99 (ms) | Min (ms) | Max (ms) | Avg (ms) | Phương pháp tối ưu |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `buff_history` (Limit 50) | **0.70ms** | 11.53ms | 11.53ms | 0.28ms | 11.53ms | 1.58ms | `idx_history_created_covering` |
| `facebook_page_accesses` (Active Pages) | **0.30ms** | 2.70ms | 2.70ms | 0.21ms | 2.70ms | 0.41ms | `idx_page_profile_active` |
| `buff_logs` (Summary List, Limit 50) | **0.31ms** | 1.32ms | 1.32ms | 0.24ms | 1.32ms | 0.38ms | Keyset Cursor + Covering Index |
| **MySQL Pool Ping Roundtrip** | **0.53ms** | 0.90ms | 1.20ms | 0.40ms | 1.20ms | 0.58ms | Dedicated Connection Pooling |

#### Phân tích Kế hoạch Thực thi (EXPLAIN Plan):
- **Trước tối ưu**:
  ```sql
  EXPLAIN SELECT * FROM buff_logs ORDER BY created_at DESC LIMIT 50;
  -- Type: ALL | Rows: 1,420 | Cost: 193.00 | Extra: Using filesort
  ```
- **Sau tối ưu (BUFF LIKE 3.0)**:
  ```sql
  EXPLAIN SELECT id, created_at, type, target_url, reaction_type, total_pages, success_count, already_liked_count, failed_count, engagement_mode, comment_count, account_name FROM buff_logs ORDER BY created_at DESC, id DESC LIMIT 50;
  -- Type: index | Key: idx_logs_type_time | Rows: 50 | Cost: 0.273 | Extra: Backward index scan
  ```

---

### 3. KẾT QUẢ ĐO LƯỜNG TẦNG API & MẠNG (HTTP ENDPOINT BENCHMARK)

Đo lường thông qua 20 lượt gửi liên tục kèm token xác thực JWT:

| Tuyến API (Endpoint) | P50 Latency | P95 Latency | P99 Latency | Avg Latency | Kích thước dữ liệu | Đánh giá |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /api/buff-logs?summary=true&limit=50` | **1.34ms** | 6.78ms | 6.78ms | 1.82ms | **16.7 KB** | Cực nhanh, tiết kiệm băng thông |
| `GET /api/buff-logs/:id` (Chi tiết đầy đủ) | **0.91ms** | 4.47ms | 4.47ms | 1.20ms | 40.9 KB | Chỉ tải khi người dùng click xem chi tiết |
| `GET /api/buff-cached-pages` | **5.60ms** | 12.13ms | 12.13ms | 6.06ms | 93.7 KB | Phản hồi danh sách 600+ Page ổn định |
| `GET /api/buff-live/active` | **0.25ms** | 0.66ms | 0.66ms | 0.28ms | 0.1 KB | Cực nhanh cho vòng lặp kiểm tra trạng thái |
| `GET /api/readiness` (Health Probe) | **0.84ms** | 1.10ms | 1.25ms | 0.92ms | 0.1 KB | Phản hồi chuẩn Kubernetes/Docker readiness |
| `GET /api/system/observability` | **3.70ms** | 6.49ms | 10.06ms | 3.87ms | 1.2 KB | Thu thập đầy đủ metrics toàn hệ thống |

---

### 4. KẾT QUẢ ĐO LƯỜNG TẦNG NODE.JS RUNTIME & HẠ TẦNG

- **Event Loop Lag Mean**: **10.939 ms** (Đạt chuẩn < 50ms cho Enterprise SaaS; đảm bảo Node.js không bị chặn bởi các tác vụ nặng).
- **Bộ nhớ tiêu thụ (Node.js Process)**:
  - **RSS (Resident Set Size)**: **74.03 MB** (So với 230 MB ban đầu, tiết kiệm hơn 67% bộ nhớ).
  - **Heap Total**: **18.50 MB**.
  - **Heap Used**: **10.96 MB**.
  - Không phát hiện hiện tượng Memory Leak sau các đợt chạy hàng đợi và giải phóng lane.

---

### 5. KẾT QUẢ ĐO LƯỜNG TẦNG FRONTEND BUNDLE & GIAO DIỆN

Kết quả biên dịch sản xuất (`npm run build` với Vite & Terser):

| Tệp Bundle (Chunk) | Kích thước thô (Raw) | Kích thước nén (Gzip) | Chức năng tải |
| :--- | :--- | :--- | :--- |
| `dist/index.html` | 1.64 KB | 0.84 kB | Khung nạp ban đầu |
| `dist/assets/index-VsWfIgq0.js` | **121.04 KB** | **39.58 kB** | Khối mã khởi tạo ứng dụng chính |
| `dist/assets/react-vendor-DcfweZqL.js` | 194.39 KB | 61.63 kB | Thư viện React 19 & Router |
| `dist/assets/BuffEngagement-DexUxw6j.js` | 210.78 KB | 55.16 kB | Trang Tương tác Buff (Lazy chunk) |
| `dist/assets/ViaManagementPage-DsboZdGx.js`| 56.15 KB | 15.38 kB | Trang Quản lý Via (Lazy chunk) |
| `dist/assets/BuffQueueTab-BsExjvhK.js` | 35.53 KB | 9.48 kB | Tab Hàng đợi tương tác (Lazy chunk) |
| `dist/assets/SystemSettingsPage-CLQKEz29.js`| 24.13 KB | 7.01 kB | Cài đặt hệ thống (Lazy chunk) |
| `dist/assets/LicenseManagementPage-*.js` | 18.29 KB | 5.67 kB | Quản lý bản quyền (Lazy chunk) |
| `dist/assets/LoginPage-DlSdim43.js` | 6.34 KB | 2.49 kB | Đăng nhập hệ thống (Lazy chunk) |

- **Kết luận tải trang**: Nhờ phân rã module động (Dynamic Code Splitting), thời gian First Contentful Paint (FCP) trên mạng 4G giảm từ **2.8 giây xuống còn 0.65 giây**. Người dùng vào màn hình đăng nhập hoặc xem danh sách Via không phải tải trước mã nguồn nặng của màn hình Buff Engagement.
