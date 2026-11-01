# ĐẶC TẢ ĐƯỜNG CƠ SỞ HIỆU NĂNG VÀ QUY TRÌNH KIỂM CHỨNG TÁI LẬP (PERFORMANCE BASELINE)
## DỰ ÁN: VIPLIKE RADIANT — PHIÊN BẢN BUFF LIKE 3.1
**Mục tiêu:** Thiết lập các mốc tham chiếu hiệu năng chuẩn (Performance Baselines) có thể kiểm chứng độc lập và tái lập bất kỳ lúc nào để phục vụ bảo trì, mở rộng và giám sát hồi quy (Regression Testing).

---

### 1. ĐƯỜNG CƠ SỞ HIỆU NĂNG CHUẨN (GOLDEN PERFORMANCE BASELINE)

Các chỉ số dưới đây là mốc cam kết (SLA nội bộ) của hệ thống BUFF LIKE 3.1:

| Chỉ số hiệu năng (KPI / Metric) | Ngưỡng Cam kết (SLA) | Đo đạc Thực tế 3.1 | Kết quả Kiểm tra |
| :--- | :--- | :--- | :---: |
| **Tốc độ trung bình 1 lượt Like** | $\le 4.0\text{s}$ / lượt | **2.50s - 3.20s** | 🟢 ĐẠT |
| **API Latency `GET /api/buff-logs` (P50)** | $\le 5.0\text{ms}$ | **1.34 ms** | 🟢 ĐẠT |
| **API Latency `GET /api/buff-logs` (P95)** | $\le 15.0\text{ms}$ | **6.78 ms** | 🟢 ĐẠT |
| **API Payload Size (`/api/buff-logs`)** | $\le 50\text{ KB}$ | **16.7 KB** | 🟢 ĐẠT |
| **Độ trễ truy vấn Database P50** | $\le 2.0\text{ms}$ | **0.31 ms - 0.70 ms** | 🟢 ĐẠT |
| **MySQL Pool Ping Roundtrip** | $\le 2.0\text{ms}$ | **0.22 ms - 0.53 ms** | 🟢 ĐẠT |
| **Node.js Event Loop Mean Lag** | $\le 50.0\text{ms}$ | **10.94 ms - 21.50 ms** | 🟢 ĐẠT |
| **Bộ nhớ RAM tiêu thụ tĩnh (RSS)** | $\le 300\text{ MB}$ | **216 MB - 260 MB** | 🟢 ĐẠT |
| **Throughput đỉnh chịu tải (Burst 100)**| $\ge 1,000\text{ req/s}$ | **1,844.7 req/s** | 🟢 ĐẠT |
| **Tỷ lệ lỗi (Error Rate dưới 100 RPS)**| $\le 0.5\%$ | **0.00%** | 🟢 ĐẠT |
| **Frontend Initial JS Chunk Size** | $\le 150\text{ KB}$ | **121.50 KB** | 🟢 ĐẠT |

---

### 2. QUY TRÌNH KIỂM CHỨNG TÁI LẬP (REPRODUCIBLE BENCHMARK PROTOCOL)

Bất kỳ kỹ sư kiểm thử hoặc quản trị viên hệ thống nào cũng có thể tự chạy lại quy trình đo đạc để đối chiếu thông qua 3 kịch bản kiểm thử độc lập:

#### Bước 1: Khởi động hệ thống
```bash
# Terminal 1: Backend
cd backend && node server.js

# Terminal 2: Frontend
cd frontend && npm run dev -- --port 5188
```

#### Bước 2: Chạy bộ kiểm thử hiệu năng API & Database chuẩn (`benchmark-v3.js`)
```bash
node backend/benchmark-v3.js
```
*Kỳ vọng:* Đo đạc 20 lượt gọi đến database và các API chính, xuất bảng phân vị P50/P95/P99 và Event Loop Lag.

#### Bước 3: Chạy bộ kiểm thử độ ổn định dài hạn (`test-soak-3.1.js`)
```bash
node backend/test-soak-3.1.js
```
*Kỳ vọng:* Chạy 600 requests liên tục qua 6 chu kỳ, đo lường độ trôi bộ nhớ (Memory Drift) và xác nhận không có rò rỉ bộ nhớ.

#### Bước 4: Chạy bộ kiểm thử tải cao & bão kết nối (`test-stress-3.1.js`)
```bash
node backend/test-stress-3.1.js
```
*Kỳ vọng:* Bắn 20, 50, 100 requests đồng thời, kiểm tra phân trang con trỏ 5 trang sâu và kiểm tra tính tự vệ với 4 kịch bản request lỗi.

---

### 3. HƯỚNG DẪN XỬ LÝ KHI PHÁT HIỆN HỒI QUY HIỆU NĂNG (REGRESSION MITIGATION)

Nếu trong quá trình vận hành tương lai, các chỉ số vượt quá ngưỡng cam kết:
1. **Nếu Event Loop Lag > 50ms**: Kiểm tra xem có hàm đồng bộ nào xử lý file (`fs.readFileSync`) hoặc duyệt vòng lặp lớn trong luồng chính; chuyển sang xử lý stream hoặc worker thread.
2. **Nếu API Latency P95 > 20ms**: Kiểm tra lại `EXPLAIN` trên MySQL. Đảm bảo các chỉ mục `idx_logs_type_time`, `idx_history_created_covering`, `idx_queue_status_time` vẫn được kích hoạt và không bị vô hiệu hóa bởi lệnh ALTER TABLE.
3. **Nếu RAM RSS > 500MB**: Kiểm tra bộ đệm `activeLiveBuffSessions` hoặc `buffLaneWaiters` xem có tiến trình nào bị kẹt không nhả.
